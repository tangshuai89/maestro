const API_BASE = '/api';

export type MusicProvider = 'qq' | 'netease';

export const PROVIDER_LABELS: Record<MusicProvider, string> = {
  qq: 'QQ 音乐',
  netease: '网易云音乐',
};

export interface Track {
  id: string;
  provider: MusicProvider;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  audioUrl: string;
  duration: number;
  liked: boolean;
}

export interface AuthStatus {
  provider: MusicProvider;
  loggedIn: boolean;
  user: { nickname: string; avatarUrl: string; openId: string } | null;
}

export async function fetchNextTrack(provider: MusicProvider): Promise<Track> {
  const res = await fetch(`${API_BASE}/music/next?provider=${provider}`);
  return res.json();
}

export async function toggleLike(
  provider: MusicProvider,
  trackId: string,
): Promise<{ success: boolean; liked: boolean }> {
  const res = await fetch(
    `${API_BASE}/music/like/${trackId}?provider=${provider}`,
    { method: 'POST' },
  );
  return res.json();
}

export async function getAuthStatus(
  provider: MusicProvider,
): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE}/auth/status?provider=${provider}`);
  return res.json();
}

export function getLoginUrl(provider: MusicProvider): string {
  return `${API_BASE}/auth/login?provider=${provider}`;
}

export async function logout(provider: MusicProvider): Promise<void> {
  await fetch(`${API_BASE}/auth/logout?provider=${provider}`);
}
