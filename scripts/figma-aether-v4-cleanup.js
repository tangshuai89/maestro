// ─────────────────────────────────────────────────────────────
// AETHER THEATER v4-ABC — 孤儿组件清理（一次性）
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 页面：02 · Components
// 作用：删除 v4 旧版遗留组件集/组件（剧场版已替代，留驻会污染 AI 读到的组件清单）。
// 只删旧名，不动新组件集与屏幕实例（旧集从未被实例化，删除安全）。
// ─────────────────────────────────────────────────────────────

const SEG1 = `
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '02 · Components') || figma.currentPage;
const OLD_NAMES = ['Button/Play', 'Tag/Label', 'Cover/Art', 'Progress/Seekbar', 'Card/Glass', 'Card/Reco', 'Track/Info'];
const removed = [];
page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })
  .filter(n => OLD_NAMES.includes(n.name))
  .forEach(n => { removed.push(n.name); n.remove(); });
const left = page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).map(n => n.name);
return { removed, remaining: left };
`;

module.exports = { SEG1 };
