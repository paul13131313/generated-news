import { buildPrompt } from './prompt.js';
import { callClaude, parseGeneratedJson } from './claude.js';
import { FEED_SOURCES } from './feeds.js';
import { fetchAndParseFeed } from './parser.js';
import {
  requireAdmin,
  handleAdminAuth,
  handleAdminStats,
  handleSampleIssue,
  handleSampleList,
  handleSampleGet,
  handleSampleLatest,
  handleSubscriberList,
  handleSubscriberExport,
  handleInviteList,
  handleInviteCreate,
  handleInviteDeactivate,
  handleDeliveryLogs,
  writeDeliveryLog,
  handleStatsDailyChart,
  writeDailyStats,
  handleAnnounce,
  handleAnnouncementList,
  handleSubscriberUpdate,
  handleApplyInvite,
} from './admin.js';

/**
 * 生成新聞 - 紙面生成 Worker
 *
 * Endpoints:
 *   GET /api/generate              → 紙面JSON（キャッシュ優先、なければ生成）
 *   GET /api/generate?edition=morning → 朝刊指定
 *   GET /api/generate?edition=evening → 夕刊指定
 *   GET /api/generate?force=true   → キャッシュ無視して再生成
 *   GET /health                    → ヘルスチェック
 *
 * Cron Triggers:
 *   0 21 * * * (UTC) = 06:00 JST → 朝刊生成・キャッシュ
 *   0  8 * * * (UTC) = 17:00 JST → 夕刊生成・キャッシュ
 *
 * Environment:
 *   CLAUDE_API_KEY (secret) — Anthropic API key
 *   UNSPLASH_ACCESS_KEY (secret) — Unsplash API key
 *   NEWSPAPER_CACHE (KV) — キャッシュ用KV namespace
 */

const ALLOWED_ORIGINS = [
  'https://seiseishinbun.com',
  'https://paul13131313.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const CACHE_TTL = 12 * 60 * 60; // 12時間（秒）

function getCorsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status = 200, request = null) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getCorsHeaders(request),
    },
  });
}

/**
 * 時間帯から版を判定（JST基準）
 * 6:00〜16:59 → 朝刊, 17:00〜5:59 → 夕刊
 */
function detectEdition() {
  const jstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getHours();
  return (jstHour >= 6 && jstHour < 17) ? 'morning' : 'evening';
}

/**
 * JSTの日付文字列を取得 (例: "2026-02-12")
 */
function getJstDateString() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * キャッシュキーを生成 (例: "morning-2026-02-12")
 */
function getCacheKey(edition) {
  return `${edition}-${getJstDateString()}`;
}

/**
 * RSSフィードから直接ニュースを取得（Worker間通信の制約回避）
 */
async function fetchNews(limit = 50) {
  const results = await Promise.allSettled(
    FEED_SOURCES.map((source) => fetchAndParseFeed(source))
  );

  const articles = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    }
  }

  // 新しい順にソート
  articles.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  // 重複除去
  const seen = new Set();
  const unique = articles.filter((article) => {
    if (seen.has(article.url)) return false;
    seen.add(article.url);
    return true;
  });

  console.log(`Fetched ${unique.length} unique articles from ${FEED_SOURCES.length} feeds`);
  return unique.slice(0, limit);
}

/**
 * Unsplash APIで写真を検索
 * @returns {{ imageUrl: string, imageCredit: string } | null}
 */
async function searchUnsplash(accessKey, query) {
  const encoded = encodeURIComponent(query);
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encoded}&orientation=landscape&per_page=3`,
    { headers: { Authorization: `Client-ID ${accessKey}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;
  const photo = data.results[0];
  return {
    imageUrl: photo.urls.regular,
    imageCredit: photo.user.name,
    imageCreditLink: photo.user.links.html,
    unsplashLink: photo.links.html,
  };
}

async function fetchUnsplashImage(accessKey, keyword) {
  if (!accessKey || !keyword) return null;
  try {
    // 1. そのまま検索
    let result = await searchUnsplash(accessKey, keyword);
    if (result) return result;

    // 2. キーワードを短縮してリトライ（末尾の単語を1つずつ削る）
    const words = keyword.split(/\s+/);
    for (let len = words.length - 1; len >= 2; len--) {
      const shorter = words.slice(0, len).join(' ');
      console.log(`Unsplash retry: "${shorter}"`);
      result = await searchUnsplash(accessKey, shorter);
      if (result) return result;
    }

    // 3. 最初の2語だけで試す
    if (words.length > 2) {
      const twoWords = words.slice(0, 2).join(' ');
      console.log(`Unsplash retry (2 words): "${twoWords}"`);
      result = await searchUnsplash(accessKey, twoWords);
      if (result) return result;
    }

    console.warn(`Unsplash: no results for "${keyword}" after retries`);
    return null;
  } catch (err) {
    console.error('Unsplash fetch error:', err);
    return null;
  }
}

/**
 * Nominatimで逆ジオコーディング（座標→地名）
 * KVキャッシュ付き（7日間）
 */
async function reverseGeocode(lat, lon, kvCache) {
  // KVキャッシュ確認（小数点3桁に丸める = 約111m精度）
  const cacheKey = `geo-${lat.toFixed(3)}-${lon.toFixed(3)}`;
  if (kvCache) {
    const cached = await kvCache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=16&accept-language=ja`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GeneratedNews/1.0 (local-news-feature)' },
  });

  if (!res.ok) {
    console.warn('Nominatim API failed:', res.status);
    return null;
  }

  const data = await res.json();
  const addr = data.address || {};

  const area = addr.quarter || addr.neighbourhood || addr.suburb
    || addr.city_district || addr.city || addr.state || '';
  const broader = addr.city_district || addr.city || addr.state || '';

  const result = { area, broader, raw: addr };

  // KVに7日間キャッシュ
  if (kvCache) {
    await kvCache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 7 * 24 * 60 * 60,
    });
  }

  return result;
}

/**
 * Google News RSSでローカルニュースを取得
 */
async function fetchLocalNewsFromGoogle(areaName) {
  const queries = [areaName];

  const allArticles = [];
  for (const q of queries) {
    const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`;
    try {
      const articles = await fetchAndParseFeed({
        url: feedUrl,
        name: 'Google News',
        category: 'ローカル',
        format: 'rss2',
      });
      allArticles.push(...articles);
    } catch (err) {
      console.warn(`Google News fetch failed for "${q}":`, err.message);
    }
  }

  // 重複除去、最大4件
  const seen = new Set();
  return allArticles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  }).slice(0, 10);
}

/**
 * ご近所情報エンドポイント用ハンドラ
 * GET /api/local-news?lat=35.65&lon=139.71
 */
async function handleLocalNews(lat, lon, env) {
  const kvCache = env.NEWSPAPER_CACHE;

  // 1. 逆ジオコーディング
  const geo = await reverseGeocode(lat, lon, kvCache);
  const area = geo?.area || '';
  const broader = geo?.broader || '';

  if (!area && !broader) {
    return { localNews: null, error: 'Could not determine area from coordinates' };
  }

  const searchArea = area || broader;

  // 2. KVキャッシュ確認（エリア+日付で6時間）
  const dateStr = getJstDateString();
  const cacheKey = `local-${searchArea}-${dateStr}`;
  if (kvCache) {
    const cached = await kvCache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  // 3. Google News RSSで実ニュース取得
  let articles = await fetchLocalNewsFromGoogle(searchArea);

  // 4. 結果が少なければ広域で再検索
  if (articles.length < 2 && broader && broader !== searchArea) {
    const broaderArticles = await fetchLocalNewsFromGoogle(broader);
    const existingUrls = new Set(articles.map(a => a.url));
    for (const a of broaderArticles) {
      if (!existingUrls.has(a.url)) {
        articles.push(a);
        if (articles.length >= 4) break;
      }
    }
  }

  const result = {
    localNews: {
      title: 'ご近所情報',
      area: searchArea,
      items: articles.map(a => ({
        title: a.title,
        body: a.summary || '',
        url: a.url,
        source: a.source || 'Google News',
      })),
    },
  };

  // 5. KVに6時間キャッシュ
  if (kvCache) {
    await kvCache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 6 * 60 * 60,
    });
  }

  return result;
}

/**
 * 文化ニュースRSSから催事データを取得（展示会・映画）
 * Claude生成ではなく実データに基づく催事コーナー
 */
async function fetchCultureNews(areaName = '') {
  try {
    const feeds = [
      { url: 'https://artscape.jp/feed/', name: 'artscape', category: '展示会', format: 'rss2' },
      { url: 'https://www.cinra.net/feed', name: 'CINRA.NET', category: '文化', format: 'rss2' },
      { url: 'https://www.cinemacafe.net/rss/index.rdf', name: 'cinemacafe', category: '映画', format: 'rdf' },
    ];

    // 位置情報がある場合、地域のイベント情報をGoogle Newsから追加取得
    if (areaName) {
      const localEventUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(areaName + ' イベント 展覧会')}&hl=ja&gl=JP&ceid=JP:ja`;
      feeds.push({ url: localEventUrl, name: 'Google News', category: '地域イベント', format: 'rss2' });
    }

    const allItems = [];

    for (const feed of feeds) {
      try {
        const articles = await fetchAndParseFeed(feed);
        allItems.push(...articles.map(a => ({ ...a, sourceCategory: feed.category, sourceName: feed.name })));
      } catch (err) {
        console.warn(`Culture feed ${feed.name} failed:`, err.message);
      }
    }

    // 重複除去
    const seenUrl = new Set();
    const deduped = allItems.filter(a => {
      if (seenUrl.has(a.url)) return false;
      seenUrl.add(a.url);
      return true;
    });

    // ソース多様化: 各ソースから最大1件ずつ選び、3件ちょうどに
    const seenSource = new Set();
    const diverse = [];
    for (const a of deduped) {
      if (seenSource.has(a.sourceName)) continue;
      seenSource.add(a.sourceName);
      diverse.push(a);
      if (diverse.length >= 3) break;
    }
    // 3件に満たない場合は残りから補充
    if (diverse.length < 3) {
      for (const a of deduped) {
        if (diverse.includes(a)) continue;
        diverse.push(a);
        if (diverse.length >= 3) break;
      }
    }

    if (diverse.length === 0) return null;

    return {
      title: '催事',
      items: diverse.map(a => ({
        type: a.sourceCategory,
        title: a.title,
        description: a.summary ? a.summary.slice(0, 30) : '',
        url: a.url,
        sourceUrl: a.url,
        sourceName: a.sourceName,
        source: a.sourceName,
      })),
    };
  } catch (err) {
    console.error('Culture news fetch error:', err);
    return null;
  }
}

/**
 * 株価・為替・BTCの実データを取得
 * Stooq CSV API (株価・為替) + CoinGecko (BTC)
 */
async function fetchMarketData() {
  const ticker = [];

  try {
    // Stooq CSV API: 日経平均, TOPIX, ドル円, NYダウ, S&P500
    const stooqSymbols = [
      { symbol: '^nkx', name: '日経平均', isForex: false },
      { symbol: '^tpx', name: 'TOPIX', isForex: false },
      { symbol: 'usdjpy', name: 'ドル円', isForex: true },
      { symbol: '^dji', name: 'NYダウ', isForex: false },
      { symbol: '^spx', name: 'S&P500', isForex: false },
    ];
    const symbolStr = stooqSymbols.map(s => s.symbol).join('+');
    const stooqUrl = `https://stooq.com/q/l/?s=${symbolStr}&f=sd2t2ohlcv&h&e=csv`;
    const stooqRes = await fetch(stooqUrl, {
      headers: { 'User-Agent': 'GeneratedNews/1.0' },
    });

    if (stooqRes.ok) {
      const csvText = await stooqRes.text();
      const lines = csvText.trim().split('\n');
      // 1行目はヘッダー: Symbol,Date,Time,Open,High,Low,Close,Volume
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 7) continue;
        const sym = cols[0].trim().toLowerCase();
        const open = parseFloat(cols[3]);
        const close = parseFloat(cols[6]);
        if (isNaN(open) || isNaN(close)) continue;

        const info = stooqSymbols.find(s => s.symbol === sym);
        if (!info) continue;

        const change = close - open;
        ticker.push({
          name: info.name,
          value: info.isForex ? close.toFixed(2) : close.toLocaleString('en-US', { maximumFractionDigits: 0 }),
          change: (change >= 0 ? '+' : '') + (info.isForex ? change.toFixed(2) : change.toLocaleString('en-US', { maximumFractionDigits: 0 })),
        });
      }
    } else {
      console.warn('Stooq API failed:', stooqRes.status);
    }
  } catch (err) {
    console.error('Stooq fetch error:', err);
  }

  try {
    // CoinGecko: BTC
    const btcUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true';
    const btcRes = await fetch(btcUrl);

    if (btcRes.ok) {
      const btcData = await btcRes.json();
      const btc = btcData?.bitcoin;
      if (btc && btc.usd != null) {
        const price = Math.round(btc.usd);
        const changePct = btc.usd_24h_change || 0;
        ticker.push({
          name: 'BTC',
          value: price.toLocaleString('en-US'),
          change: (changePct >= 0 ? '+' : '') + changePct.toFixed(1) + '%',
        });
      }
    } else {
      console.warn('CoinGecko API failed:', btcRes.status);
    }
  } catch (err) {
    console.error('CoinGecko fetch error:', err);
  }

  return ticker;
}

/**
 * はてなブックマーク ホットエントリから「ネットで話題」データを取得
 * Claude生成ではなく実データに基づくSNSトレンド代替
 */
async function fetchHatenaHotEntries() {
  try {
    const feeds = [
      { url: 'https://b.hatena.ne.jp/hotentry.rss', category: '総合' },
      { url: 'https://b.hatena.ne.jp/hotentry/it.rss', category: 'テクノロジー' },
    ];

    const allItems = [];

    for (const feed of feeds) {
      const articles = await fetchAndParseFeed({
        name: `はてブ（${feed.category}）`,
        url: feed.url,
        category: feed.category,
        format: 'rdf',
      });
      allItems.push(...articles);
    }

    // 重複除去（URLベース）、最新順で最大3件
    const seen = new Set();
    const unique = allItems.filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    }).slice(0, 3);

    // snsTrend形式に変換
    return {
      title: 'ネットで話題',
      items: unique.map(a => ({
        platform: 'はてブ',
        topic: a.title,
        description: '',
        url: a.url,
      })),
      flame: null,
    };
  } catch (err) {
    console.error('Hatena hot entries fetch error:', err);
    return null;
  }
}

/**
 * 天気データをOpen-Meteo APIから取得（東京・無料・キー不要）
 * WMO Weather Code → 日本語天気名に変換
 */
async function fetchWeatherData(lat = 35.6895, lon = 139.6917) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=Asia/Tokyo&forecast_days=1`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn('Open-Meteo API failed:', res.status);
    return null;
  }

  const data = await res.json();
  const daily = data?.daily;
  if (!daily) return null;

  // WMO Weather Code → 日本語
  const weatherCodeMap = {
    0: '快晴', 1: '晴れ', 2: '晴れ時々くもり', 3: 'くもり',
    45: '霧', 48: '霧', 51: '小雨', 53: '雨', 55: '雨',
    56: '凍雨', 57: '凍雨', 61: '小雨', 63: '雨', 65: '大雨',
    66: '凍雨', 67: '凍雨', 71: '小雪', 73: '雪', 75: '大雪',
    77: '霰', 80: 'にわか雨', 81: 'にわか雨', 82: '激しい雨',
    85: 'にわか雪', 86: 'にわか雪', 95: '雷雨', 96: '雷雨', 99: '雷雨',
  };

  const code = daily.weather_code?.[0];
  const weather = weatherCodeMap[code] || 'くもり';
  const tempHigh = String(Math.round(daily.temperature_2m_max?.[0] ?? 0));
  const tempLow = String(Math.round(daily.temperature_2m_min?.[0] ?? 0));
  const rain = String(daily.precipitation_probability_max?.[0] ?? 0) + '%';

  return { weather, tempHigh, tempLow, rain };
}

/**
 * 夕刊ティッカー用: 明日の天気を主要都市で取得し、株価風フォーマットで返す
 * Open-Meteo APIで複数都市の明日の天気を一括取得
 */
async function fetchWeatherTicker(userLat = 35.6895, userLon = 139.6917) {
  const cities = [
    { name: '東京', lat: 35.6895, lon: 139.6917 },
    { name: '大阪', lat: 34.6937, lon: 135.5023 },
    { name: '名古屋', lat: 35.1815, lon: 136.9066 },
    { name: '札幌', lat: 43.0621, lon: 141.3544 },
    { name: '福岡', lat: 33.5904, lon: 130.4017 },
    { name: '仙台', lat: 38.2682, lon: 140.8694 },
    { name: '那覇', lat: 26.2124, lon: 127.6809 },
  ];

  // ユーザーの位置情報がデフォルト（東京）でなければ先頭に「現在地」として追加
  const distFromTokyo = Math.abs(userLat - 35.6895) + Math.abs(userLon - 139.6917);
  if (distFromTokyo > 0.1) {
    cities.unshift({ name: '現在地', lat: userLat, lon: userLon });
  }

  const ticker = [];

  // WMO Weather Code → 天気アイコン（株価の矢印の代わり）
  const weatherIcon = {
    0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
    45: '🌫', 48: '🌫', 51: '🌦', 53: '🌧', 55: '🌧',
    56: '🧊', 57: '🧊', 61: '🌦', 63: '🌧', 65: '🌧',
    66: '🧊', 67: '🧊', 71: '🌨', 73: '❄️', 75: '❄️',
    77: '🌨', 80: '🌦', 81: '🌧', 82: '🌧',
    85: '🌨', 86: '🌨', 95: '⛈', 96: '⛈', 99: '⛈',
  };

  const weatherName = {
    0: '快晴', 1: '晴れ', 2: '晴れ時々くもり', 3: 'くもり',
    45: '霧', 48: '霧', 51: '小雨', 53: '雨', 55: '雨',
    56: '凍雨', 57: '凍雨', 61: '小雨', 63: '雨', 65: '大雨',
    66: '凍雨', 67: '凍雨', 71: '小雪', 73: '雪', 75: '大雪',
    77: '霰', 80: 'にわか雨', 81: 'にわか雨', 82: '激しい雨',
    85: 'にわか雪', 86: 'にわか雪', 95: '雷雨', 96: '雷雨', 99: '雷雨',
  };

  // 全都市の座標をカンマ区切りで一括リクエスト
  const lats = cities.map(c => c.lat).join(',');
  const lons = cities.map(c => c.lon).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=Asia/Tokyo&forecast_days=2`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('Weather ticker API failed:', res.status);
      return ticker;
    }
    const data = await res.json();

    // Open-Meteoは複数地点の場合、配列で返す
    const results = Array.isArray(data) ? data : [data];

    for (let i = 0; i < Math.min(cities.length, results.length); i++) {
      const daily = results[i]?.daily;
      if (!daily) continue;

      // 明日のデータ（index 1）。なければ今日（index 0）
      const idx = daily.temperature_2m_max?.length > 1 ? 1 : 0;
      const code = daily.weather_code?.[idx] ?? 3;
      const high = Math.round(daily.temperature_2m_max?.[idx] ?? 0);
      const low = Math.round(daily.temperature_2m_min?.[idx] ?? 0);
      const rain = daily.precipitation_probability_max?.[idx] ?? 0;
      const icon = weatherIcon[code] || '☁️';
      const name_ja = weatherName[code] || 'くもり';

      // 株価風フォーマット: 都市名 → name, 天気+気温 → value, 降水確率 → change
      ticker.push({
        name: cities[i].name,
        value: `${icon}${name_ja} ${high}/${low}℃`,
        change: `☂${rain}%`,
      });
    }
  } catch (err) {
    console.error('Weather ticker fetch error:', err);
  }

  return ticker;
}

/**
 * 前の版の記事タイトル一覧をKVから取得（重複排除用）
 */
async function getPreviousEditionTitles(kvCache, edition) {
  if (!kvCache) return [];

  const dateStr = getJstDateString();

  if (edition === 'evening') {
    // 夕刊生成時 → 同日朝刊の記事タイトルを取得
    const morningKey = `morning-${dateStr}`;
    const morningData = await kvCache.get(morningKey);
    if (morningData) {
      try {
        const parsed = JSON.parse(morningData);
        const titles = [];
        if (parsed.newspaper?.headline?.title) titles.push(parsed.newspaper.headline.title);
        if (parsed.newspaper?.articles) {
          for (const a of parsed.newspaper.articles) {
            if (a.title) titles.push(a.title);
          }
        }
        return titles;
      } catch (e) { /* ignore parse error */ }
    }
  } else {
    // 朝刊生成時 → 前日夕刊の記事タイトルを取得
    const yesterday = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const eveningKey = `evening-${yesterdayStr}`;
    const eveningData = await kvCache.get(eveningKey);
    if (eveningData) {
      try {
        const parsed = JSON.parse(eveningData);
        const titles = [];
        if (parsed.newspaper?.headline?.title) titles.push(parsed.newspaper.headline.title);
        if (parsed.newspaper?.articles) {
          for (const a of parsed.newspaper.articles) {
            if (a.title) titles.push(a.title);
          }
        }
        return titles;
      } catch (e) { /* ignore parse error */ }
    }
  }

  return [];
}

/**
 * 前の版の催事・ご近所情報URLをKVから取得（重複排除用）
 * 直近2版（前の版 + その前の版）のURLを収集
 */
async function getPreviousCornerUrls(kvCache, edition) {
  if (!kvCache) return { cultureUrls: new Set(), localUrls: new Set() };

  const cultureUrls = new Set();
  const localUrls = new Set();
  const dateStr = getJstDateString();
  const yesterday = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  // 直近2版のキーを決定
  const keysToCheck = [];
  if (edition === 'evening') {
    keysToCheck.push(`morning-${dateStr}`);     // 同日朝刊
    keysToCheck.push(`evening-${yesterdayStr}`); // 前日夕刊
  } else {
    keysToCheck.push(`evening-${yesterdayStr}`); // 前日夕刊
    keysToCheck.push(`morning-${yesterdayStr}`); // 前日朝刊
  }

  for (const key of keysToCheck) {
    try {
      const data = await kvCache.get(key);
      if (!data) continue;
      const parsed = JSON.parse(data);

      // 催事URLを収集
      if (parsed.newspaper?.culture?.items) {
        for (const item of parsed.newspaper.culture.items) {
          if (item.url) cultureUrls.add(item.url);
        }
      }

      // ご近所情報URLを収集
      if (parsed.newspaper?.localNews?.items) {
        for (const item of parsed.newspaper.localNews.items) {
          if (item.url) localUrls.add(item.url);
        }
      }
    } catch (e) { /* ignore parse error */ }
  }

  return { cultureUrls, localUrls };
}

/**
 * 紙面を生成
 */
async function generateNewspaper(apiKey, edition, unsplashKey, kvCache, lat = 35.6895, lon = 139.6917) {
  // 1. ニュース取得
  const articles = await fetchNews(50);
  if (articles.length === 0) {
    throw new Error('No news articles available');
  }

  // 2. 前の版の記事タイトルを取得（重複排除用）
  const previousTitles = await getPreviousEditionTitles(kvCache, edition);

  // 2b. 前の版の催事・ご近所情報URLを取得（重複排除用）
  const { cultureUrls: prevCultureUrls, localUrls: prevLocalUrls } = await getPreviousCornerUrls(kvCache, edition);

  // 2c. 逆ジオコーディング（位置情報→地名）
  let areaName = '恵比寿・渋谷エリア';
  let geoResult = null;
  try {
    geoResult = await reverseGeocode(lat, lon, kvCache);
    if (geoResult) {
      const area = geoResult.area || '';
      const broader = geoResult.broader || '';
      areaName = area ? `${area}エリア` : (broader ? `${broader}エリア` : areaName);
    }
  } catch (err) {
    console.warn('Reverse geocode failed, using default area:', err.message);
  }

  // 3. プロンプト構築
  const { systemPrompt, userPrompt } = buildPrompt(articles, edition, previousTitles, areaName);

  // 3. Claude API呼び出し
  const rawText = await callClaude(apiKey, systemPrompt, userPrompt);

  // 4. JSONパース
  const newspaper = parseGeneratedJson(rawText);

  // 5. ティッカー実データ取得（Claudeに生成させない）
  // 朝刊: 株価・為替（Stooq + CoinGecko）
  // 夕刊: 明日の天気予報（Open-Meteo 主要7都市）
  if (edition === 'evening') {
    try {
      const weatherTicker = await fetchWeatherTicker(lat, lon);
      if (weatherTicker.length > 0) {
        newspaper.ticker = weatherTicker;
      }
    } catch (err) {
      console.error('Weather ticker fetch failed:', err);
    }
  } else {
    try {
      const marketData = await fetchMarketData();
      if (marketData.length > 0) {
        newspaper.ticker = marketData;
      }
    } catch (err) {
      console.error('Market data fetch failed:', err);
    }
  }

  // 6. 天気データ実データ取得（Open-Meteo API）
  // 夕刊ではティッカーに天気を表示するため、本紙の天気セクションは非表示
  if (edition === 'evening') {
    // 夕刊: weatherFashionを削除してフロント側で非表示にする
    delete newspaper.weatherFashion;
  } else {
    try {
      const weatherData = await fetchWeatherData(lat, lon);
      if (weatherData && newspaper.weatherFashion) {
        newspaper.weatherFashion.title = '天気と服装';
        newspaper.weatherFashion.weather = weatherData.weather;
        newspaper.weatherFashion.tempHigh = weatherData.tempHigh;
        newspaper.weatherFashion.tempLow = weatherData.tempLow;
        newspaper.weatherFashion.rain = weatherData.rain;
      }
    } catch (err) {
      console.error('Weather data fetch failed:', err);
    }
  }

  // 8. SNSトレンド → はてブホットエントリ実データで上書き
  try {
    const hatenaData = await fetchHatenaHotEntries();
    if (hatenaData && hatenaData.items.length > 0) {
      newspaper.snsTrend = hatenaData;
    }
  } catch (err) {
    console.error('Hatena hot entries fetch failed:', err);
  }

  // 10. 催事 → 文化ニュースRSSから実データで上書き（前の版と重複するURLを除外）
  try {
    const geoAreaForCulture = geoResult?.broader || geoResult?.area || '';
    const cultureData = await fetchCultureNews(geoAreaForCulture);
    if (cultureData && cultureData.items.length > 0) {
      const dedupedItems = cultureData.items.filter(item => !prevCultureUrls.has(item.url));
      if (dedupedItems.length > 0) {
        newspaper.culture = { ...cultureData, items: dedupedItems };
      } else {
        newspaper.culture = {
          title: '催事・展覧会',
          items: [{ title: '※本日の新着催事情報はありませんでした', body: '', url: '', sourceUrl: '', sourceName: '', source: '' }],
        };
      }
    }
  } catch (err) {
    console.error('Culture news fetch failed:', err);
  }

  // 10b. ご近所情報 → Google News RSS（位置情報ベースの動的検索）
  try {
    // 逆ジオコーディング結果から検索語・フィルタ語を構築
    const geoArea = geoResult?.area || '';
    const geoBroader = geoResult?.broader || '';
    const localSearchTerms = [];
    const localFilter = [];

    if (geoArea) {
      localSearchTerms.push(geoArea);
      localFilter.push(geoArea);
    }
    if (geoBroader && geoBroader !== geoArea) {
      localSearchTerms.push(geoBroader);
      localFilter.push(geoBroader);
    }

    // フォールバック: ジオコーディング失敗時はデフォルト
    if (localSearchTerms.length === 0) {
      localSearchTerms.push('恵比寿', '渋谷');
      localFilter.push('恵比寿', '渋谷', '代官山', '中目黒', '広尾');
    }

    const allLocal = [];

    for (const term of localSearchTerms) {
      try {
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(term)}&hl=ja&gl=JP&ceid=JP:ja`;
        const resp = await fetch(feedUrl, {
          headers: { 'User-Agent': 'GeneratedNews/1.0', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
        });
        if (resp.ok) {
          const xml = await resp.text();
          const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
          let m;
          while ((m = itemRegex.exec(xml)) !== null) {
            const itemXml = m[1];
            const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
            const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
            const sourceMatch = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/);
            if (titleMatch) {
              allLocal.push({
                title: titleMatch[1].trim(),
                url: linkMatch ? linkMatch[1].trim() : '',
                source: sourceMatch ? sourceMatch[1].trim() : 'Google News',
              });
            }
          }
        }
      } catch (innerErr) {
        console.warn(`Local news fetch for "${term}" failed:`, innerErr.message);
      }
    }

    // 重複排除（同一フェッチ内 + 前の版との重複）+ タイトルに地名が含まれる記事のみ採用
    const seenLocalUrl = new Set();
    const filtered = allLocal.filter(a => {
      if (seenLocalUrl.has(a.url)) return false;
      if (prevLocalUrls.has(a.url)) return false;
      seenLocalUrl.add(a.url);
      return localFilter.some(name => a.title.includes(name));
    });

    if (filtered.length > 0) {
      newspaper.localNews = {
        title: 'ご近所情報',
        area: areaName,
        items: filtered.slice(0, 4).map(a => {
          // titleからメディア名サフィックスを除去（「 - Yahoo!ニュース」等）
          const cleanTitle = a.title.replace(/\s*[-–—|]\s*[^-–—|]+$/, '').trim() || a.title;
          return {
            title: cleanTitle,
            body: '',
            url: a.url,
            sourceUrl: a.url,
            sourceName: a.source || 'Google News',
            source: a.source || 'Google News',
          };
        }),
      };
    } else {
      newspaper.localNews = {
        title: 'ご近所情報',
        area: areaName,
        items: [{ title: '※本日の新着ご近所ニュースはありませんでした', body: '', url: '', sourceUrl: '', sourceName: '', source: '' }],
      };
    }
  } catch (err) {
    console.error('Local news fetch failed:', err);
  }

  // 11. Unsplash写真取得（headline + articles）
  if (unsplashKey) {
    const photoPromises = [];

    // headline写真
    const headlineKeyword = newspaper.headline?.imageKeyword;
    if (headlineKeyword) {
      photoPromises.push(
        fetchUnsplashImage(unsplashKey, headlineKeyword).then(photo => {
          if (photo) {
            newspaper.headline.imageUrl = photo.imageUrl;
            newspaper.headline.imageCredit = photo.imageCredit;
            newspaper.headline.imageCreditLink = photo.imageCreditLink;
            newspaper.headline.unsplashLink = photo.unsplashLink;
          }
        })
      );
    }

    // articles写真（imageKeywordがある記事のみ）
    if (newspaper.articles) {
      newspaper.articles.forEach((article, i) => {
        if (article.imageKeyword) {
          photoPromises.push(
            fetchUnsplashImage(unsplashKey, article.imageKeyword).then(photo => {
              if (photo) {
                newspaper.articles[i].imageUrl = photo.imageUrl;
                newspaper.articles[i].imageCredit = photo.imageCredit;
                newspaper.articles[i].imageCreditLink = photo.imageCreditLink;
                newspaper.articles[i].unsplashLink = photo.unsplashLink;
              }
            })
          );
        }
      });
    }

    // 並列で写真取得
    await Promise.all(photoPromises);
  }

  return {
    newspaper,
    meta: {
      edition,
      sourceArticleCount: articles.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 紙面を生成してKVにキャッシュ
 */
async function generateAndCache(env, edition, lat = 35.6895, lon = 139.6917) {
  const startTime = Date.now();
  const result = await generateNewspaper(env.CLAUDE_API_KEY, edition, env.UNSPLASH_ACCESS_KEY, env.NEWSPAPER_CACHE, lat, lon);
  const elapsed = Date.now() - startTime;

  const cached = {
    ...result,
    meta: {
      ...result.meta,
      elapsedMs: elapsed,
      cached: true,
      cachedAt: new Date().toISOString(),
    },
  };

  // KVに保存（TTL: 12時間）
  const cacheKey = getCacheKey(edition);
  if (env.NEWSPAPER_CACHE) {
    await env.NEWSPAPER_CACHE.put(cacheKey, JSON.stringify(cached), {
      expirationTtl: CACHE_TTL,
    });
    console.log(`Cached ${cacheKey} (${elapsed}ms, TTL ${CACHE_TTL}s)`);
  }

  return cached;
}

/**
 * ルーティング
 */
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(request) });
  }

  // Health check
  if (path === '/health') {
    return jsonResponse({
      status: 'ok',
      service: 'news-generator',
      timestamp: new Date().toISOString(),
      hasApiKey: !!env.CLAUDE_API_KEY,
      hasUnsplashKey: !!env.UNSPLASH_ACCESS_KEY,
      hasCache: !!env.NEWSPAPER_CACHE,
    }, 200, request);
  }

  // ご近所情報（位置情報ベース）
  if (path === '/api/local-news') {
    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));
    if (isNaN(lat) || isNaN(lon)) {
      return jsonResponse({ error: 'lat and lon query parameters are required' }, 400, request);
    }
    try {
      const result = await handleLocalNews(lat, lon, env);
      return jsonResponse(result, 200, request);
    } catch (error) {
      console.error('Local news error:', error);
      return jsonResponse({ error: 'Local news fetch failed', message: error.message }, 500, request);
    }
  }

  // 紙面生成（キャッシュ優先）
  if (path === '/api/generate') {
    if (!env.CLAUDE_API_KEY) {
      return jsonResponse({ error: 'CLAUDE_API_KEY not configured' }, 500, request);
    }

    const edition = url.searchParams.get('edition') || detectEdition();
    if (edition !== 'morning' && edition !== 'evening') {
      return jsonResponse({ error: 'Invalid edition. Use "morning" or "evening".' }, 400, request);
    }

    const force = url.searchParams.get('force') === 'true';

    // 位置情報パラメータ（デフォルト: 東京都渋谷区）
    const lat = parseFloat(url.searchParams.get('lat')) || 35.6461;
    const lon = parseFloat(url.searchParams.get('lon')) || 139.7100;

    // キャッシュ確認（force=true でなければ）
    if (!force && env.NEWSPAPER_CACHE) {
      const cacheKey = getCacheKey(edition);
      const cachedData = await env.NEWSPAPER_CACHE.get(cacheKey);
      if (cachedData) {
        console.log(`Cache hit: ${cacheKey}`);
        const parsed = JSON.parse(cachedData);
        return jsonResponse(parsed, 200, request);
      }
      console.log(`Cache miss: ${cacheKey}`);

      // フォールバック: 該当版がなければ反対の版を返す（生成はしない）
      const fallbackEdition = edition === 'morning' ? 'evening' : 'morning';
      const fallbackKey = getCacheKey(fallbackEdition);
      const fallbackData = await env.NEWSPAPER_CACHE.get(fallbackKey);
      if (fallbackData) {
        console.log(`Fallback cache hit: ${fallbackKey}`);
        const parsed = JSON.parse(fallbackData);
        return jsonResponse(parsed, 200, request);
      }

      // 前日の反対版も試す（日付をまたいだ直後のケース）
      const yesterday = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const yesterdayKey = `${fallbackEdition}-${yesterdayStr}`;
      const yesterdayData = await env.NEWSPAPER_CACHE.get(yesterdayKey);
      if (yesterdayData) {
        console.log(`Yesterday fallback cache hit: ${yesterdayKey}`);
        const parsed = JSON.parse(yesterdayData);
        return jsonResponse(parsed, 200, request);
      }
    }

    // キャッシュなし or force → 生成してキャッシュ
    try {
      const result = await generateAndCache(env, edition, lat, lon);
      return jsonResponse(result, 200, request);
    } catch (error) {
      console.error('Generation error:', error);
      return jsonResponse({
        error: 'Generation failed',
        message: error.message,
      }, 500, request);
    }
  }

  // ===== Admin: 認証 (認証不要) =====
  if (path === '/api/admin/auth' && request.method === 'POST') {
    const result = await handleAdminAuth(request, env);
    const status = result._status || 200;
    delete result._status;
    return jsonResponse(result, status, request);
  }

  // ===== 見本紙: 最新取得 (認証不要) =====
  if (path === '/api/sample/latest' && request.method === 'GET') {
    const result = await handleSampleLatest(env);
    const status = result._status || 200;
    delete result._status;
    return jsonResponse(result, status, request);
  }

  // ===== 見本紙: 公開取得 (認証不要) =====
  const sampleMatch = path.match(/^\/api\/sample\/([^/]+)$/);
  if (sampleMatch && request.method === 'GET') {
    const result = await handleSampleGet(sampleMatch[1], env);
    const status = result._status || 200;
    delete result._status;
    return jsonResponse(result, status, request);
  }

  // ===== Admin API: 以下はJWT認証必須 =====
  if (path.startsWith('/api/admin/')) {
    const isAdmin = await requireAdmin(request, env);
    if (!isAdmin) {
      return jsonResponse({ error: 'Unauthorized' }, 401, request);
    }

    // GET /api/admin/stats
    if (path === '/api/admin/stats' && request.method === 'GET') {
      const result = await handleAdminStats(env);
      return jsonResponse(result, 200, request);
    }

    // POST /api/admin/sample/issue
    if (path === '/api/admin/sample/issue' && request.method === 'POST') {
      const result = await handleSampleIssue(request, env);
      const status = result._status || 200;
      delete result._status;
      return jsonResponse(result, status, request);
    }

    // GET /api/admin/sample/list
    if (path === '/api/admin/sample/list' && request.method === 'GET') {
      const result = await handleSampleList(env);
      return jsonResponse(result, 200, request);
    }

    // GET /api/admin/subscribers
    if (path === '/api/admin/subscribers' && request.method === 'GET') {
      const result = await handleSubscriberList(env);
      const status = result._status || 200;
      delete result._status;
      return jsonResponse(result, status, request);
    }

    // GET /api/admin/subscribers/export
    if (path === '/api/admin/subscribers/export' && request.method === 'GET') {
      const result = await handleSubscriberExport(env);
      if (result._status) {
        return jsonResponse({ error: result.error }, result._status, request);
      }
      return new Response(result._csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="subscribers-${new Date().toISOString().slice(0, 10)}.csv"`,
          ...getCorsHeaders(request),
        },
      });
    }

    // GET /api/admin/invites
    if (path === '/api/admin/invites' && request.method === 'GET') {
      const result = await handleInviteList(env);
      const status = result._status || 200;
      delete result._status;
      return jsonResponse(result, status, request);
    }

    // POST /api/admin/invites
    if (path === '/api/admin/invites' && request.method === 'POST') {
      const result = await handleInviteCreate(request, env);
      const status = result._status || 200;
      delete result._status;
      return jsonResponse(result, status, request);
    }

    // POST /api/admin/subscribers/{email}/apply-invite — 招待コード適用
    const applyInviteMatch = path.match(/^\/api\/admin\/subscribers\/(.+)\/apply-invite$/);
    if (applyInviteMatch && request.method === 'POST') {
      const email = decodeURIComponent(applyInviteMatch[1]);
      const result = await handleApplyInvite(email, request, env);
      const status = result._status || 200;
      delete result._status;
      return jsonResponse(result, status, request);
    }

    // PATCH /api/admin/subscribers/{email} — 購読者メールアドレス更新
    const subscriberMatch = path.match(/^\/api\/admin\/subscribers\/(.+)$/);
    if (subscriberMatch && request.method === 'PATCH') {
      const email = decodeURIComponent(subscriberMatch[1]);
      const result = await handleSubscriberUpdate(email, request, env);
      const status = result._status || 200;
      delete result._status;
      return jsonResponse(result, status, request);
    }

    // PATCH /api/admin/invites/{code}
    const inviteMatch = path.match(/^\/api\/admin\/invites\/([^/]+)$/);
    if (inviteMatch && request.method === 'PATCH') {
      const result = await handleInviteDeactivate(inviteMatch[1], env);
      const status = result._status || 200;
      delete result._status;
      return jsonResponse(result, status, request);
    }

    // GET /api/admin/delivery-logs
    if (path === '/api/admin/delivery-logs' && request.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '30');
      const result = await handleDeliveryLogs(env, days);
      return jsonResponse(result, 200, request);
    }

    // GET /api/admin/stats/daily — 購読者推移グラフ用
    if (path === '/api/admin/stats/daily' && request.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '7');
      const result = await handleStatsDailyChart(env, days);
      return jsonResponse(result, 200, request);
    }

    // POST /api/admin/announce — お知らせ配信
    if (path === '/api/admin/announce' && request.method === 'POST') {
      const result = await handleAnnounce(request, env);
      const status = result._status || 200;
      delete result._status;
      return jsonResponse(result, status, request);
    }

    // GET /api/admin/announcements — お知らせ履歴
    if (path === '/api/admin/announcements' && request.method === 'GET') {
      const result = await handleAnnouncementList(env);
      return jsonResponse(result, 200, request);
    }

    return jsonResponse({ error: 'Admin endpoint not found' }, 404, request);
  }

  // 404
  return jsonResponse({
    error: 'Not Found',
    endpoints: [
      'GET /api/generate',
      'GET /api/generate?edition=morning',
      'GET /api/generate?edition=evening',
      'GET /api/generate?force=true',
      'GET /health',
      'POST /api/admin/auth',
      'GET /api/admin/stats',
      'POST /api/admin/sample/issue',
      'GET /api/admin/sample/list',
      'GET /api/sample/{id}',
    ],
  }, 404, request);
}

export default {
  // HTTP handler
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal Server Error', message: error.message }, 500, request);
    }
  },

  // Cron Trigger handler
  async scheduled(event, env, ctx) {
    if (!env.CLAUDE_API_KEY) {
      console.error('Cron: CLAUDE_API_KEY not configured');
      return;
    }

    // UTC 21:00 = JST 06:00 → 朝刊, UTC 08:00 = JST 17:00 → 夕刊
    const hour = new Date(event.scheduledTime).getUTCHours();
    const edition = (hour === 21) ? 'morning' : 'evening';

    console.log(`Cron triggered: generating ${edition} edition (UTC ${hour}:00)`);

    const logData = { status: 'success', elapsedMs: null, emailSent: null, emailFailed: null };

    try {
      const result = await generateAndCache(env, edition);
      logData.elapsedMs = result.meta.elapsedMs;
      console.log(`Cron: ${edition} generated and cached (${result.meta.elapsedMs}ms)`);

      // Push通知を送信
      if (env.PUSH_API) {
        try {
          const pushRes = await env.PUSH_API.fetch('https://push-api/api/push/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edition }),
          });
          const pushResult = await pushRes.json();
          console.log(`Push: sent=${pushResult.sent}, failed=${pushResult.failed}, expired=${pushResult.expired}`);
        } catch (pushError) {
          console.error('Push notification failed:', pushError);
        }
      }

      // メール配信を送信
      if (env.EMAIL_API) {
        try {
          const emailRes = await env.EMAIL_API.fetch('https://email-notifier/api/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edition }),
          });
          const emailResult = await emailRes.json();
          logData.emailSent = emailResult.sent ?? null;
          logData.emailFailed = emailResult.failed ?? null;
          console.log(`Email: sent=${emailResult.sent}, failed=${emailResult.failed}`);
        } catch (emailError) {
          console.error('Email notification failed:', emailError);
        }
      }

      // Threads投稿
      if (env.THREADS_API) {
        try {
          const threadsRes = await env.THREADS_API.fetch('https://threads-poster/api/threads/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edition }),
          });
          const threadsResult = await threadsRes.json();
          if (threadsResult.skipped) {
            console.log('Threads: already posted, skipped');
          } else if (threadsResult.success) {
            console.log(`Threads: posted, id=${threadsResult.threadId}`);
          } else {
            console.error('Threads: post failed:', threadsResult.error);
          }
        } catch (threadsError) {
          console.error('Threads post failed:', threadsError);
        }
      }
    } catch (error) {
      logData.status = 'failed';
      logData.error = error.message;
      console.error(`Cron: ${edition} generation failed:`, error);
    } finally {
      // 配信ログをKVに記録
      await writeDeliveryLog(env, edition, logData).catch(e => console.error('writeDeliveryLog failed:', e));
      // 日次購読者統計を記録（グラフ用）
      await writeDailyStats(env).catch(e => console.error('writeDailyStats failed:', e));
    }
  },
};
