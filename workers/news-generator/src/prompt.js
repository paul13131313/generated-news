/**
 * 紙面生成プロンプト設計
 *
 * コスト目標: 1回 ≤ 5円
 * claude-haiku-4-5: 入力$1.00/MTok, 出力$5.00/MTok
 * → 入力~2000tok + 出力~2000tok = ~$0.012 ≈ 1.8円 → OK
 */

/**
 * 和暦・曜日を生成
 */
function getJapaneseDate(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getFullYear();
  const month = jst.getMonth() + 1;
  const day = jst.getDate();

  // 令和変換（2019年5月1日〜）
  const reiwaYear = year - 2018;
  const kanjiNums = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

  function toKanji(n) {
    if (n <= 10) return kanjiNums[n];
    if (n < 20) return '十' + (n === 10 ? '' : kanjiNums[n - 10]);
    if (n < 30) return '二十' + (n === 20 ? '' : kanjiNums[n - 20]);
    if (n < 40) return '三十' + (n === 30 ? '' : kanjiNums[n - 30]);
    return String(n);
  }

  const weekDays = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const weekDay = weekDays[jst.getDay()];

  return `令和${toKanji(reiwaYear)}年 ${toKanji(month)}月${toKanji(day)}日（${weekDay}）`;
}

/**
 * 号数を生成（日付ベース: 2026-01-01を第〇〇一号として日ごとに加算）
 */
function getIssueNumber(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const base = new Date('2026-01-01T00:00:00+09:00');
  const diffDays = Math.floor((jst - base) / (1000 * 60 * 60 * 24)) + 1;
  const num = Math.max(1, diffDays);
  const padded = String(num).padStart(3, '0');
  // 漢数字ゼロ埋め
  const kanjiMap = { '0': '〇', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七', '8': '八', '9': '九' };
  const kanjiNum = padded.split('').map(c => kanjiMap[c]).join('');
  return `第${kanjiNum}号`;
}

/**
 * ニュース記事一覧をプロンプト用に圧縮
 * トークン節約: title + source + category のみ送信（summaryは省略可）
 */
function compressArticles(articles, maxCount = 30) {
  // カテゴリごとにバランスよく選出
  const byCategory = {};
  for (const a of articles) {
    if (!byCategory[a.category]) byCategory[a.category] = [];
    byCategory[a.category].push(a);
  }

  const selected = [];
  const categories = Object.keys(byCategory);
  const perCategory = Math.max(3, Math.ceil(maxCount / categories.length));

  for (const cat of categories) {
    const items = byCategory[cat].slice(0, perCategory);
    selected.push(...items);
  }

  return selected.slice(0, maxCount).map((a, i) =>
    `${i + 1}. [${a.category}] ${a.title}${a.summary ? ' — ' + a.summary.slice(0, 60) : ''}`
  ).join('\n');
}

/**
 * システムプロンプト
 */
const SYSTEM_PROMPT = `あなたは「生成新聞」の紙面編集AIです。
格式ある新聞調の文体で、知的な遊び心を持って紙面を構成してください。

文体の特徴:
- 漢語・熟語を多用する硬質な新聞文体
- 一文は短く歯切れ良く。体言止めも活用
- 数字は漢数字（二〇二六年、三十八万円など）
- 「——」（ダッシュ）で補足説明を挿入する文体
- 客観的報道調だが、コラムでは随筆的な味わいを出す

出力はJSON形式のみ。説明文や前置きは不要。`;

/**
 * ユーザープロンプトを組み立て
 */
export function buildPrompt(articles, edition = 'morning') {
  const now = new Date();
  const dateStr = getJapaneseDate(now);
  const issueNum = getIssueNumber(now);
  const editionStr = edition === 'evening' ? '夕刊' : '朝刊';
  const compressed = compressArticles(articles);

  const userPrompt = `以下のニュース一覧から${editionStr}の紙面JSONを生成してください。

日付: ${dateStr}
版: ${editionStr}
号数: ${issueNum}

ニュース一覧:
${compressed}

以下のJSON構造で出力（全フィールド必須）:
{
  "date": "${dateStr}",
  "edition": "${editionStr}",
  "issueNumber": "${issueNum}",
  "headline": {
    "kicker": "一面",
    "title": "最重要ニュースの見出し（20字以内）",
    "body": "4〜6文の本文（200〜300字）",
    "imageKeyword": "英語1〜2語の写真検索キーワード（例: semiconductor, diplomacy summit, stock market）"
  },
  "articles": [
    {
      "category": "カテゴリ名",
      "label": "小見出しラベル（4字以内: 人工知能, 経済動向 等）",
      "title": "見出し（25字以内）",
      "body": "2〜3文の本文（100字程度）"
    }
  ],
  "column": {
    "title": "天声生成",
    "body": "今日のニュースに触発された随筆的コラム（3段落, 各段落60〜80字, 段落間は改行2つ）"
  },
  "ticker": [
    { "name": "日経平均", "value": "38,942", "change": "+312" },
    { "name": "ドル円", "value": "152.34", "change": "-0.42" }
  ],
  "highlights": [
    { "title": "注目記事の見出し", "summary": "一文の要約（40字以内）" }
  ]
}

制約:
- articles配列は5件ちょうど（総合1, テクノロジー1, 国際1, 経済1, 社会/政治/スポーツ/文化から1）
- highlights配列は5件
- ticker配列は6件（日経平均, TOPIX, ドル円, NYダウ, S&P500, BTC）
- tickerの数値はニュース一覧から推測できなければモック値でよい
- コラムは具体的なニュースに言及しつつ、哲学的・文学的な深みを持たせる
- headline.imageKeywordは英語で、Unsplash写真検索に適した具体的な単語（1〜2語）
- JSONのみ出力。マークダウンのコードブロック(\`\`\`)で囲まないこと`;

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
