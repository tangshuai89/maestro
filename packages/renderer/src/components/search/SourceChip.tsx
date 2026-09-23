import { PROVIDER_LABELS } from '../../api';
import type { MusicProvider, UnifiedSourceInfo } from '../../api';

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
 * SourceChip 末尾的付费状态角标：[P] / [NP]。
 *  - paid-album + vipLocked=true → [NP]（未购，黄色 / 红色 背景）
 *  - paid-album + vipLocked=false → [P]（已购或 VIP 解锁）
 *  - 其他 vipCategory（paid-track/vip-only/vip-month）不显示 P/NP 标签
 *    —— 这些不是数字专辑，UI 上只通过 bestSource 跳过 / ⚠ 排序等机制区分，
 *    不在 chip 上标。后续如果用户对其他付费类型有显示诉求再扩展。
 *
 * 网易云 [P] 是粗略等价：vipLocked=false + fee=1 → 可能是黑胶 VIP 解锁，
 * 也可能是真的购买。tooltip 里写明「可能未购」让用户知情。
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
 *  The bestSource platform gets its brand colour + ★; no-copyright ones are
 *  greyed with a strikethrough. 付费专辑（paid-album）额外加 [P]/[NP] tag。 */
export default function SourceChip({
  source,
  isBest,
}: {
  source: UnifiedSourceInfo;
  isBest: boolean;
}) {
  // paid-album 给 chip 加 .source-chip--paid-album 类 —— CSS 切到平台 brand
  // 强背景（黄/红），跟普通 chip 的弱化背景区分。
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
      {providerShort(source.platform)}
      <AlbumTag source={source} />
      {isBest && <span className="source-chip-best">★</span>}
    </span>
  );
}
