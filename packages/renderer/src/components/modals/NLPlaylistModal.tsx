/**
 * NL playlist modal（specs/nl-playlist/ §Task B2）。
 *
 * 弹窗形态：shadcn Dialog + Textarea 输入自然语言 → POST /api/reco/parse-intent →
 * 展示 NLIntent（mood / genres / tempo / language / era 等结构化意图）。
 *
 * 本 commit 范围（B1+B2+B3）：
 *   - 输入 + 解析 + 展示意图
 *   - ✨ 入口：SearchPanel（theater 模式）+ MiniPlayer（lite 模式）点击触发
 *
 * 不在本 commit：
 *   - 队列生成 / 覆盖 vs 追加切换（commit 7 = C1-C4 prompt 调试 + e2e）
 *   - 保存为歌单（commit 5 = B4+B5 usePlaylist hook + 歌单列表 UI）
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
import { parseIntent as parseIntentApi, type NLIntent } from '../../api';

export interface NLPlaylistModalProps {
  open: boolean;
  onClose: () => void;
}

const SAMPLE_PROMPTS = [
  '放点适合夜跑的电子乐',
  '周末慵懒的中文民谣',
  '九十年代摇滚，排除周杰伦',
  '像 Deadmau5 那种 prog house，节奏快一点',
];

export function NLPlaylistModal({ open, onClose }: NLPlaylistModalProps) {
  const [text, setText] = React.useState('');
  const [intent, setIntent] = React.useState<NLIntent | null>(null);
  const [rationale, setRationale] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  // 关弹窗时重置 state（避免下次打开看到上次的残留）
  React.useEffect(() => {
    if (!open) {
      setText('');
      setIntent(null);
      setRationale(null);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const onGenerate = async () => {
    setError(null);
    setIntent(null);
    setRationale(null);
    setLoading(true);
    try {
      const r = await parseIntentApi(text);
      setIntent(r.intent);
      setRationale(r.intent.rationale);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message ??
        (e as Error).message ??
        'parse-intent 调用失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>✨ NL 歌单</DialogTitle>
          <DialogDescription>
            说一句话，DeepSeek 帮你解析意图（队列生成与保存见后续）
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
              // Cmd/Ctrl + Enter → 触发生成
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
                className="rounded-full border border-sh-border px-3 py-1 text-xs text-sh-muted-foreground hover:bg-sh-accent/20"
              >
                {p}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-sh-muted-foreground">
              {text.length}/500
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button
                onClick={onGenerate}
                disabled={loading || !text.trim()}
              >
                {loading ? '解析中…' : '解析意图'}
              </Button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-sh-destructive/40 bg-sh-destructive/10 p-3 text-sm text-sh-destructive-foreground"
            >
              {error}
            </div>
          )}

          {intent && (
            <div className="rounded-md border border-sh-border bg-sh-card/40 p-3 text-sm">
              <div className="mb-2 font-medium">我理解的意图</div>
              {rationale && (
                <div className="mb-2 text-sh-muted-foreground">{rationale}</div>
              )}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-sh-muted-foreground">心情</dt>
                <dd>{intent.mood || '—'}</dd>
                <dt className="text-sh-muted-foreground">风格</dt>
                <dd>{intent.genres.length ? intent.genres.join('、') : '—'}</dd>
                <dt className="text-sh-muted-foreground">节奏</dt>
                <dd>{intent.tempo}</dd>
                <dt className="text-sh-muted-foreground">语言</dt>
                <dd>{intent.language}</dd>
                <dt className="text-sh-muted-foreground">年代</dt>
                <dd>
                  {intent.era?.from ?? '?'}–{intent.era?.to ?? '今'}
                </dd>
                <dt className="text-sh-muted-foreground">目标数</dt>
                <dd>{intent.target_count}</dd>
                {intent.similar_artists.length > 0 && (
                  <>
                    <dt className="text-sh-muted-foreground">像</dt>
                    <dd>{intent.similar_artists.join('、')}</dd>
                  </>
                )}
                {intent.exclude_artists.length > 0 && (
                  <>
                    <dt className="text-sh-muted-foreground">排除艺人</dt>
                    <dd>{intent.exclude_artists.join('、')}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
