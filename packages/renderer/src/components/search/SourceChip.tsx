import { PROVIDER_LABELS } from '../../api';
import type { MusicProvider, UnifiedSourceInfo } from '../../api';
import { ProviderLogo } from './providerLogos';

/** Short platform label for the compact chips. */
function providerShort(p: MusicProvider): string {
  switch (p) {
    case 'qq':
      return 'QQ';
    case 'netease':
      return '网易';
    case 'deezer':
      return 'DZ';
    case 'spotify':
      return 'SP';
  }
}

/**
 * 数字专辑 [P]/[NP] 角标：vipCategory === 'paid-album' 时附加在 chip 文字之后。
 *  - vipLocked=true → [NP]（未购）
 *  - vipLocked=false → [P]（已购或 VIP 解锁，tooltip 注明）
 * 其他 vipCategory 不显示标签。
 */
function AlbumTag({ source }: { source: UnifiedSourceInfo }) {
  if (source.vipCategory !== 'paid-album') return null;
  const owned = !source.vipLocked;
  return (
    <span
      className={`source-chip-album source-chip-album--${owned ? 'p' : 'np'}`}
      title={
        owned
          ? `${PROVIDER_LABELS[source.platform]}：数字专辑（已购或在 VIP 覆盖范围内）`
          : `${PROVIDER_LABELS[source.platform]}：数字专辑未购`
      }
    >
      [{owned ? 'P' : 'NP'}]
    </span>
  );
}

/** Platform chip — marks which platforms a unified search result exists on.
 *  视觉：左侧 platform 品牌 logo（SVG） + 平台短名（QQ / 网易 / DZ / SP） +
 *       [P/NP] tag（数字专辑时） + bestSource ★。
 *  所有 chip 都用平台 brand 强背景色（不是 bestSource 才上色）—— 用 logo
 *  + 强背景让 chip 一眼可识别平台；bestSource 加 box-shadow 描边突出选中态。
 *
 *  降级（fallback）类 .source-chip--fallback：理论上的 logo 不可用 fallback
 *  （如未来替换成 <img src>），保留扩展点；当前 inline SVG 不触发。 */
export default function SourceChip({
  source,
  isBest,
}: {
  source: UnifiedSourceInfo;
  isBest: boolean;
}) {
  const isPaidAlbum = source.vipCategory === 'paid-album';
  return (
    <span
      className={`source-chip source-chip--${source.platform}${
        source.hasCopyright ? '' : ' source-chip--no-rights'
      }${isBest ? ' source-chip--best' : ''}${
        isPaidAlbum ? ' source-chip--paid-album' : ''
      }`}
      title={
        source.hasCopyright
          ? `${PROVIDER_LABELS[source.platform]} · 有版权${isBest ? ' · 推荐' : ''}${
              isPaidAlbum
                ? source.vipLocked
                  ? ' · 数字专辑未购'
                  : ' · 数字专辑已购'
                : ''
            }`
          : `${PROVIDER_LABELS[source.platform]} · 无版权`
      }
    >
      <span className="source-chip-logo">
        <ProviderLogo platform={source.platform} size={12} />
      </span>
      <span className="source-chip-label">{providerShort(source.platform)}</span>
      <AlbumTag source={source} />
      {isBest && <span className="source-chip-best">★</span>}
    </span>
  );
}
