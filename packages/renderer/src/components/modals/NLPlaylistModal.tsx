/**
 * NL playlist modal（specs/nl-playlist/ §Task B2 + B4 + B5）。
 *
 * 流程：自然语言 → POST /reco/parse-intent → NLIntent
 *      → POST /reco/run (intent) → UnifiedSearchItem[]（跨平台搜索回填已可播）
 *      → 播放队列 / 保存为本地歌单（POST /library/playlists）
 *
 * 组件来源：shadcn Dialog + Textarea + Button（PR #92 ownership 模式）。
 * 本 PR 范围不含：歌单内曲目排序 / 拖拽 / 多轮对话（spec §不做什么 v2）。
 */
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/textarea';
import {
  parseIntent,
  runReco,
  type NLIntent,
  type UnifiedSearchItem,
} from '../../api';
import { usePlaylist } from '../../hooks/usePlaylist';

export interface NLPlaylistModalProps {
  open: boolean;
  onClose: () => void;
  /** 播放整条队列（复用 player.playSearch，覆盖现有队列）。 */
  onPlay: (items: UnifiedSearchItem[], index: number) => void;
  /** 追加到当前队列（player.appendToQueue，不清空）。 */
  onAppendQueue?: (items: UnifiedSearchItem[]) => void;
  /** 428 无 DeepSeek key → 打开 RecoKeyModal（沿用 reco 的友好提示路径）。 */
  onNeedKey?: () => void;
  /** 当前播放队列长度——>0 且覆盖模式时先弹确认（spec §验收）。 */
  queueLength?: number;
}

const SAMPLE_PROMPTS = [
  '放点适合夜跑的电子乐',
  '周末慵懒的中文民谣',
  '九十年代摇滚，排除周杰伦',
  '像 Deadmau5 那种 prog house，节奏快一点',
];

export function NLPlaylistModal({
  open,
  onClose,
  onPlay,
  onAppendQueue,
  onNeedKey,
  queueLength = 0,
}: NLPlaylistModalProps) {
  const [text, setText] = React.useState('');
  const [intent, setIntent] = React.useState<NLIntent | null>(null);
  const [items, setItems] = React.useState<UnifiedSearchItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // 「覆盖队列 / 追加」切换（spec §UI）；覆盖且已有队列时弹确认（spec §验收）。
  const [mode, setMode] = React.useState<'replace' | 'append'>('replace');
  const [confirmItems, setConfirmItems] =
    React.useState<UnifiedSearchItem[] | null>(null);

  // 保存为歌单：二次 Dialog
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const pl = usePlaylist();

  React.useEffect(() => {
    if (!open) {
      setText('');
      setIntent(null);
      setItems([]);
      setError(null);
      setLoading(false);
      setMode('replace');
      setConfirmItems(null);
      setSaveOpen(false);
      setSaveName('');
    }
  }, [open]);

  /** 两段式：先 parse-intent（拿结构化意图）再 reco.run（拿可播曲目）。 */
  const onGenerate = async () => {
    setError(null);
    setIntent(null);
    setItems([]);
    setLoading(true);
    try {
      const { intent: parsed } = await parseIntent(text);
      setIntent(parsed);
      const res = await runReco({ intent: parsed });
      setItems(res.items ?? []);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      // 428 没设 DeepSeek key → 打开 RecoKeyModal（spec §验收：走既有 428
      // 友好提示路径）；message 是服务端原文（json() 抬上来的）。
      if (err.status === 428) onNeedKey?.();
      setError(err.message ?? '生成失败');
    } finally {
      setLoading(false);
    }
  };

  /** 整条队列播放：追加模式直接接尾；覆盖模式且已有队列先确认。 */
  const requestPlayQueue = (tracks: UnifiedSearchItem[]) => {
    if (mode === 'append' && onAppendQueue) {
      onAppendQueue(tracks);
      return;
    }
    if (queueLength > 0) {
      setConfirmItems(tracks);
      return;
    }
    onPlay(tracks, 0);
  };

  const onSave = async () => {
    if (!saveName.trim() || items.length === 0) return;
    setSaving(true);
    try {
      await pl.create({
        name: saveName.trim(),
        tracks: items,
        prompt: text.trim() || undefined,
        source: 'nl',
      });
      setSaveOpen(false);
      setSaveName('');
    } catch {
      // pl.error 已记录
    } finally {
      setSaving(false);
    }
  };

  const onOpenSave = () => {
    setSaveName(`NL ${new Date().toLocaleDateString('zh-CN')}`);
    setSaveOpen(true);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>✨ NL 歌单</DialogTitle>
          <DialogDescription>
            说一句话，DeepSeek 解析意图 → 生成可播队列 → 一键存为本地歌单
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="例：放点适合夜跑的电子乐"
            rows={3}
            maxLength={500}
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                if (!loading && text.trim()) onGenerate();
              }
            }}
          />

          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setText(p)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent/20"
              >
                {p}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {text.length}/500
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button onClick={onGenerate} disabled={loading || !text.trim()}>
                {loading ? '生成中…' : '生成队列'}
              </Button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
            >
              {error}
            </div>
          )}
          {pl.error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
            >
              歌单操作失败：{pl.error}
            </div>
          )}

          {intent && (
            <div className="rounded-md border border-border bg-card/40 p-3 text-sm">
              <div className="mb-2 font-medium">我理解的意图</div>
              {intent.rationale && (
                <div className="mb-2 text-muted-foreground">
                  {intent.rationale}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">心情</dt>
                <dd>{intent.mood || '—'}</dd>
                <dt className="text-muted-foreground">风格</dt>
                <dd>{intent.genres.length ? intent.genres.join('、') : '—'}</dd>
                <dt className="text-muted-foreground">节奏</dt>
                <dd>{intent.tempo}</dd>
                <dt className="text-muted-foreground">语言</dt>
                <dd>{intent.language}</dd>
                {intent.exclude_artists.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">排除艺人</dt>
                    <dd>{intent.exclude_artists.join('、')}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {items.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">
                  生成的队列（{items.length} 首）
                </span>
                <div className="flex items-center gap-2">
                  {/* spec §UI：覆盖当前队列 / 追加到当前队列 切换 */}
                  <div className="flex overflow-hidden rounded-md border border-border text-xs">
                    <button
                      type="button"
                      onClick={() => setMode('replace')}
                      className={`px-2.5 py-1 ${
                        mode === 'replace'
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      覆盖队列
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('append')}
                      className={`px-2.5 py-1 ${
                        mode === 'append'
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      追加
                    </button>
                  </div>
                  <Button size="sm" variant="outline" onClick={onOpenSave}>
                    保存为歌单
                  </Button>
                  <Button size="sm" onClick={() => requestPlayQueue(items)}>
                    ▶ 播放
                  </Button>
                </div>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {items.map((it, i) => (
                  <li key={it.id ?? i}>
                    <button
                      type="button"
                      onClick={() => onPlay(items, i)}
                      className="w-full truncate text-left hover:text-accent-foreground"
                    >
                      {i + 1}. {it.title} — {it.artist}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pl.playlists.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">我的歌单</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void pl.refresh()}
                  disabled={pl.loading}
                >
                  刷新
                </Button>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {pl.playlists.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => requestPlayQueue(p.tracks)}
                      disabled={p.tracks.length === 0}
                      className="flex-1 truncate text-left hover:text-accent-foreground disabled:opacity-50"
                    >
                      {p.name}（{p.tracks.length}）
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void pl.remove_playlist(p.id)}
                    >
                      删除
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>

      {/* B5：保存为歌单二次 Dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>保存为歌单</DialogTitle>
            <DialogDescription>
              给这 {items.length} 首队列起个名字
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Textarea
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="歌单名（≤ 60 字）"
              maxLength={60}
              rows={1}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaveOpen(false)}>
                取消
              </Button>
              <Button
                onClick={onSave}
                disabled={saving || !saveName.trim()}
              >
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* spec §验收：覆盖当前播放队列前的确认弹窗 */}
      <Dialog
        open={confirmItems !== null}
        onOpenChange={(o) => !o && setConfirmItems(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>替换当前队列？</DialogTitle>
            <DialogDescription>
              播放将清空当前队列
              {queueLength > 0 ? `（${queueLength} 首）` : ''}
              ，改为播放这 {confirmItems?.length ?? 0} 首。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmItems(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                const t = confirmItems;
                setConfirmItems(null);
                if (t) onPlay(t, 0);
              }}
            >
              替换并播放
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
