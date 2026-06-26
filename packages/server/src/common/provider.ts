export type MusicProvider = 'qq' | 'netease';

export const MUSIC_PROVIDERS: MusicProvider[] = ['qq', 'netease'];

export function normalizeProvider(value: string | undefined): MusicProvider {
  return value === 'netease' ? 'netease' : 'qq';
}

export const PROVIDER_LABELS: Record<MusicProvider, string> = {
  qq: 'QQ 音乐',
  netease: '网易云音乐',
};
