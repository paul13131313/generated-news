/**
 * RSSフィードソース定義
 * category: 総合, テクノロジー, 国際, 経済, 文化, 社会, 政治, スポーツ, エンタメ, 暮らし
 */
export const FEED_SOURCES = [
  // --- 総合 ---
  {
    name: 'NHKニュース（総合）',
    url: 'https://www.nhk.or.jp/rss/news/cat0.xml',
    category: '総合',
    format: 'rss2',
  },
  {
    name: 'Yahoo!ニュース',
    url: 'https://news.yahoo.co.jp/rss/topics/top-picks.xml',
    category: '総合',
    format: 'rss2',
  },

  // --- 社会 ---
  {
    name: 'NHKニュース（社会）',
    url: 'https://www.nhk.or.jp/rss/news/cat1.xml',
    category: '社会',
    format: 'rss2',
  },

  // --- 政治 ---
  {
    name: 'NHKニュース（政治）',
    url: 'https://www.nhk.or.jp/rss/news/cat4.xml',
    category: '政治',
    format: 'rss2',
  },

  // --- 経済 ---
  {
    name: 'NHKニュース（経済）',
    url: 'https://www.nhk.or.jp/rss/news/cat5.xml',
    category: '経済',
    format: 'rss2',
  },

  // --- 国際 ---
  {
    name: 'NHKニュース（国際）',
    url: 'https://www.nhk.or.jp/rss/news/cat6.xml',
    category: '国際',
    format: 'rss2',
  },

  // --- テクノロジー ---
  {
    name: 'NHKニュース（科学・文化）',
    url: 'https://www.nhk.or.jp/rss/news/cat3.xml',
    category: 'テクノロジー',
    format: 'rss2',
  },
  {
    name: 'ITmedia',
    url: 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml',
    category: 'テクノロジー',
    format: 'rss2',
  },
  {
    name: 'はてなブックマーク（IT）',
    url: 'https://b.hatena.ne.jp/hotentry/it.rss',
    category: 'テクノロジー',
    format: 'rdf',
  },
  {
    name: 'Zenn',
    url: 'https://zenn.dev/feed',
    category: 'テクノロジー',
    format: 'rss2',
  },

  // --- スポーツ ---
  {
    name: 'NHKニュース（スポーツ）',
    url: 'https://www.nhk.or.jp/rss/news/cat7.xml',
    category: 'スポーツ',
    format: 'rss2',
  },

  // --- エンタメ ---
  {
    name: 'NHKニュース（エンタメ）',
    url: 'https://www.nhk.or.jp/rss/news/cat06.xml',
    category: 'エンタメ',
    format: 'rss2',
  },
  {
    name: 'ナタリー',
    url: 'https://natalie.mu/rss/all',
    category: 'エンタメ',
    format: 'rss2',
  },

  // --- 文化 ---
  {
    name: 'NHKニュース（文化）',
    url: 'https://www.nhk.or.jp/rss/news/cat02.xml',
    category: '文化',
    format: 'rss2',
  },

  // --- 暮らし ---
  {
    name: 'NHKニュース（生活）',
    url: 'https://www.nhk.or.jp/rss/news/cat09.xml',
    category: '暮らし',
    format: 'rss2',
  },
];

/**
 * カテゴリの正規化マッピング
 * フロントのカテゴリ名 → フィード定義のカテゴリ名
 */
export const CATEGORY_MAP = {
  general: '総合',
  technology: 'テクノロジー',
  international: '国際',
  economy: '経済',
  culture: '文化',
  society: '社会',
  politics: '政治',
  sports: 'スポーツ',
  entertainment: 'エンタメ',
  lifestyle: '暮らし',
  // 日本語でもそのまま引ける
  '総合': '総合',
  'テクノロジー': 'テクノロジー',
  '国際': '国際',
  '経済': '経済',
  '文化': '文化',
  '社会': '社会',
  '政治': '政治',
  'スポーツ': 'スポーツ',
  'エンタメ': 'エンタメ',
  '暮らし': '暮らし',
};
