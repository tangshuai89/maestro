/**
 * DeezerMusicProvider 单测：editorials/preset/search/fetchRadioBatch/
 * getStreamPath/getLyrics/toTrack 全覆盖，mock global.fetch 不打真实网络。
 * 运行: npx ts-node packages/server/src/music/deezer.provider.test.ts
 */
export {};
const assert = require('node:assert');

const { DeezerMusicProvider } = require('./deezer.provider');

const prov = new DeezerMusicProvider();

// ── 辅助：mock global.fetch ──────────────────────────────────────
// 每个 test 自行 install/restore，避免互相污染。
function mockFetch(handler: (url: string, opts?: any) => any) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts?: any) => {
    const out = handler(String(url), opts);
    if (out && typeof out === 'object' && 'json' in out) return out as any;
    return {
      ok: true,
      json: async () => out,
    } as any;
  }) as any;
  return () => {
    globalThis.fetch = real;
  };
}

async function main() {
  // ── 1. isConfigured always true ────────────────────────────────
  {
    assert.strictEqual(prov.isConfigured(undefined), true);
    assert.strictEqual(
      prov.isConfigured({} as any),
      true,
      'anonymous provider always configured',
    );
    console.log('✅ 1. isConfigured 恒返回 true（匿名 provider）');
  }

  // ── 2. getEditorials() → 9 items with id/name/region ───────────
  {
    const eds = DeezerMusicProvider.getEditorials();
    assert.strictEqual(eds.length, 9, '应有 9 个 editorial');
    for (const e of eds) {
      assert.ok(typeof e.id === 'number', 'id 应为 number');
      assert.ok(typeof e.name === 'string' && e.name.length > 0);
      // region 可选，但字段必须存在（undefined 也算"存在"）
      assert.ok('region' in e, '应含 region 字段');
    }
    // 抽查：0=All, 152=摇滚
    const all = eds.find((e: any) => e.id === 0);
    assert.ok(all && all.name === 'All');
    const rock = eds.find((e: any) => e.id === 152);
    assert.ok(rock && rock.name === '摇滚');
    console.log('✅ 2. getEditorials() 返回 9 项，含 id/name/region');
  }

  // ── 3. getPresetNames() → 9 valid preset names ─────────────────
  {
    const names = DeezerMusicProvider.getPresetNames();
    assert.strictEqual(names.length, 9, '应有 9 个 preset');
    for (const n of names) {
      assert.ok(typeof n === 'string' && n.length > 0, `preset 名非法: ${n}`);
    }
    // 关键 preset 必须在
    assert.ok(names.includes('all'));
    assert.ok(names.includes('rock'));
    assert.ok(names.includes('jazz'));
    console.log('✅ 3. getPresetNames() 返回 9 个合法 preset 名');
  }

  // ── 4. isValidPreset('rock') → true ────────────────────────────
  {
    assert.strictEqual(DeezerMusicProvider.isValidPreset('rock'), true);
    console.log('✅ 4. isValidPreset("rock") → true');
  }

  // ── 5. isValidPreset('nonexistent') → false ────────────────────
  {
    assert.strictEqual(
      DeezerMusicProvider.isValidPreset('nonexistent'),
      false,
    );
    console.log('✅ 5. isValidPreset("nonexistent") → false');
  }

  // ── 6. isValidPreset('') → false ───────────────────────────────
  {
    assert.strictEqual(DeezerMusicProvider.isValidPreset(''), false);
    console.log('✅ 6. isValidPreset("") → false');
  }

  // ── 7. search with results → maps to Track correctly ───────────
  {
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 123456,
            title: 'Bohemian Rhapsody (Remastered 2011)',
            title_short: 'Bohemian Rhapsody',
            duration: 354,
            preview: 'https://cdns-preview-x.dzcdn.net/stream/abc.mp3',
            artist: { id: 1, name: 'Queen' },
            album: {
              id: 10,
              title: 'A Night at the Opera',
              cover_xl:
                'https://e-cdns-images.dzcdn.net/images/cover/xl.jpg',
            },
          },
        ],
        total: 1,
      }),
    }));
    const tracks = await prov.search({} as any, 'queen', 20);
    restore();
    assert.strictEqual(tracks.length, 1);
    const t = tracks[0];
    assert.strictEqual(t.id, '123456', 'id 应转为 string');
    assert.strictEqual(t.provider, 'deezer');
    assert.strictEqual(t.title, 'Bohemian Rhapsody', 'title 取 title_short');
    assert.strictEqual(t.artist, 'Queen', 'artist 取 artist.name');
    assert.strictEqual(
      t.coverUrl,
      'https://e-cdns-images.dzcdn.net/images/cover/xl.jpg',
      'coverUrl 取 album.cover_xl',
    );
    assert.strictEqual(
      t.audioUrl,
      'https://cdns-preview-x.dzcdn.net/stream/abc.mp3',
      'audioUrl 取 preview',
    );
    assert.strictEqual(t.duration, 354, 'duration 取整');
    assert.strictEqual(t.liked, false);
    console.log('✅ 7. search 有结果 → Track 正确映射（id/title/artist/cover/audio/duration）');
  }

  // ── 8. search with empty results → [] ──────────────────────────
  {
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({ data: [], total: 0 }),
    }));
    const tracks = await prov.search({} as any, 'zzzznotfound', 20);
    restore();
    assert.strictEqual(tracks.length, 0);
    console.log('✅ 8. search 空结果 → 返回 []');
  }

  // ── 9. search HTTP error → throws ──────────────────────────────
  {
    const restore = mockFetch(() => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    let threw = false;
    try {
      await prov.search({} as any, 'err', 20);
    } catch (e: any) {
      threw = true;
      assert.ok(/deezer search failed: 500/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, 'HTTP 错误应抛');
    console.log('✅ 9. search HTTP 500 → 抛 deezer search failed: 500');
  }

  // ── 10. fetchRadioBatch valid preset → editorial charts endpoint ─
  {
    let capturedUrl = '';
    const restore = mockFetch((url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          tracks: {
            data: [
              {
                id: 777,
                title: 'Stairway to Heaven',
                title_short: 'Stairway to Heaven',
                duration: 482,
                preview: 'https://preview.dzcdn.net/777.mp3',
                artist: { id: 2, name: 'Led Zeppelin' },
                album: {
                  id: 20,
                  title: 'Led Zeppelin IV',
                  cover_xl: 'https://img.dzcdn.net/iv.jpg',
                },
              },
            ],
          },
        }),
      };
    });
    const tracks = await prov.fetchRadioBatch({} as any, 'rock', 5);
    restore();
    assert.ok(
      /\/editorial\/152\/charts\?limit=5$/.test(capturedUrl),
      `应请求 editorial/152/charts，实际 ${capturedUrl}`,
    );
    assert.strictEqual(tracks.length, 1);
    assert.strictEqual(tracks[0].id, '777');
    assert.strictEqual(tracks[0].title, 'Stairway to Heaven');
    console.log('✅ 10. fetchRadioBatch("rock") → 命中 editorial/152/charts 并映射 Track');
  }

  // ── 11. fetchRadioBatch invalid preset → falls back to editorial 132 ─
  {
    let capturedUrl = '';
    const restore = mockFetch((url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          tracks: {
            data: [
              {
                id: 888,
                title: 'Shape of You',
                title_short: 'Shape of You',
                duration: 233,
                preview: 'https://preview.dzcdn.net/888.mp3',
                artist: { id: 3, name: 'Ed Sheeran' },
                album: { id: 30, title: '÷', cover_xl: 'https://img.dzcdn.net/div.jpg' },
              },
            ],
          },
        }),
      };
    });
    const tracks = await prov.fetchRadioBatch({} as any, 'totally-invalid', 5);
    restore();
    assert.ok(
      /\/editorial\/132\/charts/.test(capturedUrl),
      `非法 preset 应回退到 editorial/132，实际 ${capturedUrl}`,
    );
    assert.strictEqual(tracks.length, 1);
    assert.strictEqual(tracks[0].id, '888');
    console.log('✅ 11. fetchRadioBatch 非法 preset → 回退 editorial/132');
  }

  // ── 12. fetchRadioBatch empty (no tracks) → throws "returned no tracks" ─
  {
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({ tracks: { data: [] } }),
    }));
    let threw = false;
    try {
      await prov.fetchRadioBatch({} as any, 'pop', 5);
    } catch (e: any) {
      threw = true;
      assert.ok(/returned no tracks/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, '空 editorial 应抛 returned no tracks');
    console.log('✅ 12. fetchRadioBatch 空响应 → 抛 "returned no tracks"');
  }

  // ── 13. getStreamPath valid track → returns preview URL ────────
  {
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({
        id: 555,
        title: 'Yesterday',
        preview: 'https://preview.dzcdn.net/fresh-555.mp3',
        artist: { id: 4, name: 'The Beatles' },
        album: { id: 40, title: 'Help!' },
      }),
    }));
    const url = await prov.getStreamPath({} as any, '555');
    restore();
    assert.strictEqual(url, 'https://preview.dzcdn.net/fresh-555.mp3');
    console.log('✅ 13. getStreamPath 有效 track → 返回新鲜 preview URL');
  }

  // ── 14. getStreamPath track with no preview → throws "no preview url" ─
  {
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({
        id: 666,
        title: 'No Preview Song',
        preview: '',
        artist: { id: 5, name: 'X' },
        album: { id: 50, title: 'Y' },
      }),
    }));
    let threw = false;
    try {
      await prov.getStreamPath({} as any, '666');
    } catch (e: any) {
      threw = true;
      assert.ok(/no preview url/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, '无 preview 应抛 no preview url');
    console.log('✅ 14. getStreamPath 无 preview → 抛 "no preview url"');
  }

  // ── 15. getLyrics synced (syncText LRC) → parsed LyricLine[] ───
  {
    const lrc = '[00:01.00]Hello world\n[00:03.50]Second line\n[00:06.00]Third';
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({
        id: 111,
        lyrics: {
          data: [{ syncText: lrc }],
        },
      }),
    }));
    const lyrics = await prov.getLyrics('111');
    restore();
    assert.ok(Array.isArray(lyrics), '应返回数组');
    assert.strictEqual(lyrics!.length, 3);
    assert.strictEqual(lyrics![0].time, 1);
    assert.strictEqual(lyrics![0].text, 'Hello world');
    assert.strictEqual(lyrics![1].time, 3.5);
    assert.strictEqual(lyrics![1].text, 'Second line');
    assert.strictEqual(lyrics![2].time, 6);
    assert.strictEqual(lyrics![2].text, 'Third');
    console.log('✅ 15. getLyrics syncText LRC → 解析为 LyricLine[]（含时间戳）');
  }

  // ── 16. getLyrics unsynced (text only) → LyricLine[] time=0..n ─
  {
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({
        id: 222,
        lyrics: {
          data: [{ text: 'Verse one\nVerse two\nVerse three' }],
        },
      }),
    }));
    const lyrics = await prov.getLyrics('222');
    restore();
    assert.ok(Array.isArray(lyrics));
    assert.strictEqual(lyrics!.length, 3);
    assert.strictEqual(lyrics![0].time, 0);
    assert.strictEqual(lyrics![0].text, 'Verse one');
    assert.strictEqual(lyrics![1].time, 1);
    assert.strictEqual(lyrics![1].text, 'Verse two');
    assert.strictEqual(lyrics![2].time, 2);
    assert.strictEqual(lyrics![2].text, 'Verse three');
    console.log('✅ 16. getLyrics 纯文本 → LyricLine[]（time=0,1,2 递增）');
  }

  // ── 17. getLyrics no lyrics field → null ───────────────────────
  {
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({ id: 333, title: 'No Lyrics' }),
    }));
    const lyrics = await prov.getLyrics('333');
    restore();
    assert.strictEqual(lyrics, null, '无 lyrics 字段应返回 null');
    console.log('✅ 17. getLyrics 无 lyrics 字段 → 返回 null');
  }

  // ── 18. toTrack uses title_short when present, falls back to title ─
  {
    const restore = mockFetch(() => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 1,
            title: 'Long Full Title (Remastered)',
            title_short: 'Short',
            duration: 180,
            preview: 'https://p.dzcdn.net/1.mp3',
            artist: { id: 9, name: 'A' },
            album: { id: 91, title: 'Alb', cover_xl: 'https://i/1.jpg' },
          },
          {
            id: 2,
            title: 'Only Full Title',
            // 无 title_short
            duration: 200,
            preview: 'https://p.dzcdn.net/2.mp3',
            artist: { id: 8, name: 'B' },
            album: { id: 92, title: 'Alb2', cover_xl: 'https://i/2.jpg' },
          },
        ],
        total: 2,
      }),
    }));
    const tracks = await prov.search({} as any, 'q', 20);
    restore();
    assert.strictEqual(tracks[0].title, 'Short', '有 title_short 用 short');
    assert.strictEqual(
      tracks[1].title,
      'Only Full Title',
      '无 title_short 回退 title',
    );
    console.log('✅ 18. toTrack 优先 title_short，缺失时回退 title');
  }

  console.log('\n🎉 deezer.provider.test 全部 18 项通过');
}

main().catch((err) => {
  console.error('❌ deezer.provider.test 失败:', err);
  process.exit(1);
});
