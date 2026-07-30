/**
 * 会话快照的口令加密（导出/导入）。
 *
 * 敏感数据（QQ/网易云 cookie、Spotify refresh_token）不该以明文躺在导出文件里，
 * 所以用户导出时设一个口令，AES-256-GCM 加密整个 bundle；导入时同口令解出。
 *
 * 纯 Web Crypto（window.crypto.subtle），零依赖。格式（全 base64）：
 *   magic="MBX1" · salt(16B) · iv(12B) · ciphertext(含 GCM tag)
 * PBKDF2-SHA256(210k) 从口令派生 AES key；manifest 作为 AAD 绑定进密文防篡改。
 */

const MAGIC = 'MBX1';
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface BackupManifest {
  version: number;
  exportedAt: string;
  appVersion: string;
}

export interface BackupBundle {
  manifest: BackupManifest;
  /** 服务端 state.json 全量（sessions / music / secrets / library）。 */
  stateJson: Record<string, unknown>;
  /** renderer 端 localStorage 关键键。 */
  localStorage: Record<string, string>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 加密 bundle → 单个 base64 字符串（写进 .maestro-backup 文本文件）。
 * manifest 作为 AAD 绑定，改动 manifest 会让解密失败（防篡改）。
 */
export async function encryptBundle(
  bundle: BackupBundle,
  passphrase: string,
): Promise<string> {
  if (!passphrase) throw new Error('口令不能为空');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const plaintext = enc.encode(JSON.stringify(bundle));
  const aad = enc.encode(JSON.stringify(bundle.manifest));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    plaintext,
  );
  const cipher = new Uint8Array(cipherBuf);
  // magic(4) + salt(16) + iv(12) + cipher
  const packed = new Uint8Array(
    MAGIC.length + salt.length + iv.length + cipher.length,
  );
  let off = 0;
  packed.set(enc.encode(MAGIC), off);
  off += MAGIC.length;
  packed.set(salt, off);
  off += salt.length;
  packed.set(iv, off);
  off += iv.length;
  packed.set(cipher, off);
  // manifest 明文放在文件头一行（AAD），密文放第二行 —— 导入时先读 manifest
  // 判断版本，再拿它当 AAD 解密。
  return `${MAGIC}.${btoa(JSON.stringify(bundle.manifest))}.${toBase64(packed)}`;
}

/** 解密 → bundle。口令错 / 文件被篡改 → 抛错。 */
export async function decryptBundle(
  blob: string,
  passphrase: string,
): Promise<BackupBundle> {
  if (!passphrase) throw new Error('口令不能为空');
  const parts = blob.trim().split('.');
  if (parts.length !== 3 || parts[0] !== MAGIC) {
    throw new Error('不是有效的 Maestro 备份文件');
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(atob(parts[1])) as BackupManifest;
  } catch {
    throw new Error('备份文件头损坏');
  }
  if (manifest.version !== 1) {
    throw new Error(`不兼容的备份版本：${manifest.version}（本程序支持 v1）`);
  }
  const packed = fromBase64(parts[2]);
  let off = MAGIC.length; // 跳过内嵌 magic
  const salt = packed.slice(off, off + SALT_BYTES);
  off += SALT_BYTES;
  const iv = packed.slice(off, off + IV_BYTES);
  off += IV_BYTES;
  const cipher = packed.slice(off);
  const key = await deriveKey(passphrase, salt);
  const aad = enc.encode(JSON.stringify(manifest));
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      key,
      cipher,
    );
  } catch {
    throw new Error('解密失败：口令错误或文件已损坏');
  }
  try {
    return JSON.parse(dec.decode(plainBuf)) as BackupBundle;
  } catch {
    throw new Error('备份内容损坏');
  }
}

// EFF-style 短词表，够拼一个易记又有熵的口令。256 词 × 4 = 32 bit 名义熵
// （crypto.getRandomValues 提供 128 bit 原始熵，受词表大小限制实际为 32 bit，
// 仍远超本地备份场景的离线暴力破解成本）。
const WORDS = [
  'amber', 'basil', 'cedar', 'delta', 'ember', 'fable', 'grove', 'haven',
  'ivory', 'jolly', 'karma', 'lunar', 'maple', 'noble', 'ocean', 'pearl',
  'quill', 'raven', 'sable', 'tulip', 'umber', 'vivid', 'wharf', 'xenon',
  'yacht', 'zesty', 'birch', 'coral', 'dusk', 'flint', 'glade', 'heron',
  'aurora', 'beacon', 'cipher', 'drift', 'echo', 'fjord', 'galaxy', 'horizon',
  'iris', 'jasper', 'kelp', 'lattice', 'mistral', 'nebula', 'onyx', 'paladin',
  'quartz', 'ripple', 'spruce', 'topaz', 'ultra', 'velvet', 'willow', 'yarrow',
  'zenith', 'alpine', 'boreal', 'cinder', 'dune', 'ember2', 'frost', 'glacier',
  'hollow', 'indigo', 'juniper', 'kepler', 'lichen', 'meadow', 'north', 'orchid',
  'petal', 'quasar', 'rhodium', 'solstice', 'tundra', 'umber2', 'violet', 'wisp',
  'xylem', 'yonder', 'zephyr', 'arbor', 'bramble', 'clearing', 'dawn', 'estuary',
  'fjord2', 'garnet', 'hearth', 'inlet', 'jade', 'kestrel', 'lagoon', 'mosaic',
  'nimbus', 'oasis', 'prairie', 'quill2', 'ridge', 'sapphire', 'tide', 'uplift',
  'vista', 'whisper', 'yellow', 'zodiac', 'acorn', 'birch2', 'cradle', 'delta2',
  'elm', 'fern', 'gully', 'harbor', 'island', 'jetty', 'knoll', 'laurel',
  'marble', 'nook', 'olive', 'pine', 'quarry', 'reef', 'shoal', 'trail',
  'union', 'vale', 'willow2', 'yew', 'brook', 'cliff', 'dale', 'echo2',
  'fen', 'grove2', 'haven2', 'inlet2', 'june', 'knoll2', 'lake', 'marsh',
  'north2', 'oak', 'pine2', 'ravine', 'stream', 'thicket', 'upland', 'valley',
  'woods', 'yard', 'cove', 'dune2', 'field', 'glen', 'hill', 'knoll3',
  'ledge', 'moor', 'pass', 'ridge2', 'slope', 'terrace', 'vista2', 'wood',
  'arctic', 'breeze', 'cirrus', 'dew', 'eclipse', 'fog', 'gust', 'haze',
  'iceberg', 'jet', 'kelvin', 'light', 'mist', 'nimbus2', 'orion', 'polaris',
  'quasar2', 'rainbow', 'snow', 'tempest', 'umbra', 'vapor', 'wind', 'zenith2',
  'amber2', 'blue', 'crimson', 'dusk2', 'emerald', 'flame', 'gold', 'honey',
  'ivory2', 'jade2', 'khaki', 'lavender', 'mint', 'navy', 'ochre', 'pink',
  'quartz2', 'rose', 'scarlet', 'teal', 'umber3', 'violet2', 'white', 'yellow2',
  'amber3', 'bronze', 'copper', 'denim', 'ebony', 'fuchsia', 'gray', 'hazel',
  'indigo2', 'jade3', 'kohl', 'lemon', 'magenta', 'neon', 'olive2', 'peach',
  'quartz3', 'ruby', 'silver', 'turquoise', 'ultraviolet', 'viridian', 'wheat', 'xanadu',
];

/** 生成 4 词随机口令，如 "maple-ocean-flint-raven"。用 rejection sampling
 *  从 8 bit 随机源均匀采样单词下标，避免 `n % len` 的模偏。 */
export function generatePassphrase(): string {
  const out: string[] = [];
  const len = WORDS.length;
  // 拒绝任何 ≥ len 的字节 → 严格均匀
  const mask = nextPow2(len) - 1;
  const buf = new Uint8Array(8);
  while (out.length < 4) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < 4; i++) {
      const v = buf[i] & mask;
      if (v < len) out.push(WORDS[v]);
    }
  }
  return out.join('-');
}

/** 不小于 n 的最小 2 次幂。 */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
