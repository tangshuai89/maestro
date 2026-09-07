/**
 * qq-crypto 白盒测试（Node built-in assert）。
 * 运行: npx ts-node packages/server/src/music/qq-crypto.test.ts
 *
 * 覆盖：
 *  - encryptRequest → base64 字符串
 *  - encryptRequest → decrypt round-trip（AES-128-GCM）
 *  - encryptRequest 两次加密结果不同（随机 IV）
 *  - decryptResponse：循环 XOR 解密
 *  - decryptResponse round-trip（xorCycle 对合）
 *  - zzcSign：输出格式（zzc 前缀 + 小写）
 *  - zzcSign：同输入同输出（确定性）
 *  - zzcSign：不同输入不同输出
 *  - zzcSign：长度稳定
 */
export {};
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  encryptRequest,
  decryptResponse,
  zzcSign,
} = require('./qq-crypto');

let passed = 0;
let failed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${(err as Error).message}`);
    failed++;
  }
}

// AES-128-GCM key (same as production, read from source for round-trip)
const REQUEST_KEY = Buffer.from('bd305f10d0ff74b6ef54dab835b5e1cf', 'hex');
const RESPONSE_KEY = Buffer.from(
  '7a3f8c1d5e9b2f0a6c4d7e8b1f3a5c9d0e2b6f4a81',
  'hex',
);

// ── 1. encryptRequest → base64 字符串 ──────────────────────────
check('1. encryptRequest → 非空 base64 字符串', () => {
  const result = encryptRequest({ method: 'test', param: 'value' });
  assert.ok(typeof result === 'string');
  assert.ok(result.length > 0);
  // base64 字符集
  assert.ok(/^[A-Za-z0-9+/]+=*$/.test(result), '应为 base64');
});

// ── 2. encryptRequest → AES-128-GCM 解密 round-trip ───────────
check('2. encryptRequest → 手动 GCM 解密还原 JSON', () => {
  const payload = { method: 'like', songId: 12345, op: 'add' };
  const encrypted = encryptRequest(payload);
  const raw = Buffer.from(encrypted, 'base64');
  // 结构：[12B IV][CT][16B TAG]
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', REQUEST_KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  assert.deepStrictEqual(JSON.parse(decrypted), payload);
});

// ── 3. encryptRequest 两次加密结果不同（随机 IV）──────────────
check('3. encryptRequest 两次加密 → 密文不同（随机 IV）', () => {
  const a = encryptRequest({ data: 'same' });
  const b = encryptRequest({ data: 'same' });
  assert.notStrictEqual(a, b, '随机 IV 应导致不同密文');
});

// ── 4. encryptRequest 空对象 ──────────────────────────────────
check('4. encryptRequest 空对象 → 仍可解密', () => {
  const encrypted = encryptRequest({});
  const raw = Buffer.from(encrypted, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', REQUEST_KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  assert.deepStrictEqual(JSON.parse(decrypted), {});
});

// ── 5. encryptRequest 篡改密文 → GCM 认证失败 ─────────────────
check('5. 篡改密文 → GCM authTag 校验失败', () => {
  const encrypted = encryptRequest({ data: 'sensitive' });
  const raw = Buffer.from(encrypted, 'base64');
  // 翻转 CT 中间一个字节
  raw[20] ^= 0x01;
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', REQUEST_KEY, iv);
  decipher.setAuthTag(tag);
  assert.throws(() => {
    Buffer.concat([decipher.update(ct), decipher.final()]);
  }, /Unsupported state or unable to authenticate data/, 'GCM 应拒绝篡改');
});

// ── 6. decryptResponse：循环 XOR 解密 ─────────────────────────
check('6. decryptResponse：XOR 解密还原明文', () => {
  const plaintext = '{"code":200,"data":"hello"}';
  // 加密：XOR 是对合的，encrypt == decrypt
  const encrypted = Buffer.from(plaintext, 'utf8').map(
    (b, i) => b ^ RESPONSE_KEY[i % RESPONSE_KEY.length],
  );
  const decrypted = decryptResponse(encrypted);
  assert.strictEqual(decrypted, plaintext);
});

// ── 7. decryptResponse round-trip（xorCycle 对合）─────────────
check('7. decryptResponse → 再 XOR 回去 == 原始', () => {
  const plaintext = '测试中文内容 with English 123';
  const encrypted = Buffer.from(plaintext, 'utf8').map(
    (b, i) => b ^ RESPONSE_KEY[i % RESPONSE_KEY.length],
  );
  const decrypted = decryptResponse(encrypted);
  assert.strictEqual(decrypted, plaintext);
});

// ── 8. decryptResponse 空输入 ─────────────────────────────────
check('8. decryptResponse 空输入 → 空字符串', () => {
  assert.strictEqual(decryptResponse(Buffer.alloc(0)), '');
});

// ── 9. zzcSign：输出以 zzc 开头 ───────────────────────────────
check('9. zzcSign → 以 "zzc" 开头', () => {
  const sign = zzcSign('{"method":"test"}');
  assert.ok(sign.startsWith('zzc'), `应以 zzc 开头，实际: ${sign.slice(0, 6)}`);
});

// ── 10. zzcSign：输出全小写 ───────────────────────────────────
check('10. zzcSign → 全小写', () => {
  const sign = zzcSign('{"method":"test"}');
  assert.strictEqual(sign, sign.toLowerCase(), '应全小写');
});

// ── 11. zzcSign：同输入同输出（确定性）──────────────────────
check('11. zzcSign → 同输入同输出', () => {
  const payload = '{"method":"like","songId":123}';
  assert.strictEqual(zzcSign(payload), zzcSign(payload));
});

// ── 12. zzcSign：不同输入不同输出 ─────────────────────────────
check('12. zzcSign → 不同输入不同输出', () => {
  const a = zzcSign('{"method":"a"}');
  const b = zzcSign('{"method":"b"}');
  assert.notStrictEqual(a, b);
});

// ── 13. zzcSign：长度稳定（同 payload 长度 → 同 sign 长度）────
check('13. zzcSign → 同长度 payload 产生同长度 sign', () => {
  const a = zzcSign('{"method":"aaa"}');
  const b = zzcSign('{"method":"bbb"}');
  assert.strictEqual(a.length, b.length, '同长度 payload → 同长度 sign');
});

// ── 14. zzcSign：空字符串不崩溃 ───────────────────────────────
check('14. zzcSign 空字符串 → 不崩溃', () => {
  const sign = zzcSign('');
  assert.ok(sign.startsWith('zzc'));
  assert.ok(sign.length > 3, 'sign 应有内容（zzc + hash 派生）');
});

// ── 15. zzcSign：长 payload 不崩溃 ────────────────────────────
check('15. zzcSign 长 payload (10KB) → 不崩溃', () => {
  const payload = JSON.stringify({ data: 'x'.repeat(10000) });
  const sign = zzcSign(payload);
  assert.ok(sign.startsWith('zzc'));
});

// ── 16. encryptRequest + zzcSign 组合不互相干扰 ───────────────
check('16. encryptRequest + zzcSign 组合：各自独立工作', () => {
  const payload = { method: 'like', songId: 999 };
  const payloadJson = JSON.stringify(payload);
  const enc = encryptRequest(payload);
  const sign = zzcSign(payloadJson);
  assert.ok(enc.length > 0);
  assert.ok(sign.startsWith('zzc'));
  // sign 是对 JSON 字符串签名，encrypt 是对对象加密，两者独立
});

console.log(`\n🎉 qq-crypto.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
