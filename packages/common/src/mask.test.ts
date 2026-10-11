/**
 * maskUin 测试。运行: npx ts-node packages/common/src/mask.test.ts
 * 或编译后 node dist/mask.test.js
 */
export {};
const assert = require('node:assert');
const { maskUin } = require('./mask');

assert.strictEqual(maskUin('81295659'), '81***59', '8 位 uin 首尾各留 2');
assert.strictEqual(maskUin('12345'), '12***45', '5 位边界');
assert.strictEqual(maskUin('1234'), '***', '≤4 位全打码');
assert.strictEqual(maskUin(''), '?', '空串');
assert.strictEqual(maskUin(undefined), '?', 'undefined');
assert.strictEqual(maskUin(null), '?', 'null');
assert.ok(!/\d{5,}/.test(maskUin('81295659')), '输出不含 ≥5 位连续数字');
console.log('✅ mask.test.ts: maskUin 7 cases passed');
