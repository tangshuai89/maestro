/**
 * Parse a standard LRC body into sorted `LyricLine[]`. Each line has
 * the form "[mm:ss.xx]text" or "[mm:ss.xxx]text"; multi-tag lines
 * like "[mm:ss.xx][mm:ss.xx]text" are split into one line per tag
 * (this is how NetEase emits chorus repeats).
 *
 * Metadata tags without time stamps (e.g. "[ti:Title]", "[ar:Artist]")
 * are skipped — they're not singable lines.
 *
 * Returns null if no timestamped lines were found, so callers can
 * distinguish "no lyrics" from "lyrics but all unparseable".
 */
export function parseLrc(body: string): LyricLine[] | null {
  const lines: LyricLine[] = [];
  // Walk one physical line at a time. Each line may carry one or more
  // timestamp tags; NetEase emits chorus repeats as "[mm:ss.xx]text"
  // chained back-to-back, and we want each tag to produce its own
  // LyricLine sharing the trailing text.
  // Capture groups: 1 = minutes, 2 = seconds (with optional decimal).
  const tagRe = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g;
  for (const rawLine of body.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(tagRe)];
    if (matches.length === 0) continue;
    // Text is whatever follows the last tag on the line.
    const last = matches[matches.length - 1];
    const tailStart = (last.index ?? 0) + last[0].length;
    const text = rawLine.slice(tailStart).trim();
    // Skip lines whose "text" is empty/whitespace — NetEase emits
    // visual breath marks that look ugly in the panel.
    if (!text) continue;
    for (const m of matches) {
      const minutes = Number(m[1]);
      const seconds = Number(m[2]);
      // Boundary guard: minutes ∈ [0, 999], seconds ∈ [0, 60). Anything
      // outside (e.g. "[99:99.99]") would otherwise pollute the sorted
      // timeline with multi-hour phantom lines.
      if (
        !Number.isFinite(minutes) ||
        !Number.isFinite(seconds) ||
        minutes < 0 ||
        minutes > 999 ||
        seconds < 0 ||
        seconds >= 60
      ) {
        continue;
      }
      lines.push({ time: minutes * 60 + seconds, text });
    }
  }
  if (lines.length === 0) return null;
  // Sort ascending so the renderer can binary-search by currentTime.
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

export interface LyricLine {
  time: number;
  text: string;
}
