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
 * 号数を生成（朝刊=奇数, 夕刊=偶数）
 * 起算日: 2026-01-01
 * 朝刊 = (日数 × 2) - 1, 夕刊 = 日数 × 2
 */
function getIssueNumber(date = new Date(), edition = 'morning') {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const base = new Date('2026-01-01T00:00:00+09:00');
  const diffDays = Math.floor((jst - base) / (1000 * 60 * 60 * 24)) + 1;
  const days = Math.max(1, diffDays);
  const num = edition === 'evening' ? days * 2 : (days * 2) - 1;
  const padded = String(num).padStart(3, '0');
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
export function buildPrompt(articles, edition = 'morning', previousTitles = []) {
  const now = new Date();
  const dateStr = getJapaneseDate(now);
  const issueNum = getIssueNumber(now, edition);
  const editionStr = edition === 'evening' ? '夕刊' : '朝刊';
  const compressed = compressArticles(articles);

  // 重複排除指示を構築
  let dedupeInstruction = '';
  if (previousTitles.length > 0) {
    const prevEditionLabel = edition === 'evening' ? '本日の朝刊' : '前日の夕刊';
    dedupeInstruction = `\n\n【重複排除】以下の記事は${prevEditionLabel}で掲載済みです。これらとは異なるニュースを選んでください（同じトピックでも新しい展開があれば「続報」として別角度から取り上げるのはOK）:\n${previousTitles.map(t => `- ${t}`).join('\n')}`;
  }

  const userPrompt = `以下のニュース一覧から${editionStr}の紙面JSONを生成してください。

日付: ${dateStr}
版: ${editionStr}
号数: ${issueNum}${dedupeInstruction}

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
    "imageKeyword": "記事の主要な被写体を写した写真を検索するための英語2〜4語（建物・場所・物体・動作など具体的に。抽象概念NG。例: japan parliament building, tokyo stock exchange trading floor, semiconductor wafer factory, world leaders handshake summit）"
  },
  "articles": [
    {
      "category": "カテゴリ名（総合/テクノロジー/国際/経済/社会/政治/スポーツ/文化/エンタメ/暮らし）",
      "label": "小見出しラベル（4字以内: 人工知能, 経済動向, 映画, 音楽, 食, 健康 等）",
      "title": "見出し（25字以内）",
      "body": "2〜3文の本文（100字程度）",
      "imageKeyword": "英語2〜4語の写真検索キーワード or null"
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
  "numbers": [
    { "number": "13万人", "label": "米1月雇用者増加数（20字以内）" }
  ],
  "snsTrend": {
    "title": "ネットの潮目",
    "items": [
      {
        "platform": "X",
        "topic": "トレンドトピック名（ハッシュタグ含む可）",
        "description": "なぜ話題なのか1〜2文の解説",
        "url": "https://x.com/search?q=%23ハッシュタグ or https://www.youtube.com/results?search_query=検索語"
      }
    ],
    "flame": {
      "topic": "炎上中のトピック名",
      "description": "何が問題になっているか2〜3文の解説（100〜150字）",
      "url": "https://x.com/search?q=%23キーワード"
    }
  },
  "heartwarming": {
    "title": "ひだまり",
    "body": "心温まる小さなニュース1本（200〜300字）"
  },
  "localNews": {
    "title": "ご近所情報",
    "area": "渋谷区",
    "items": [
      {
        "title": "記事見出し（20字以内）",
        "body": "本文2〜3文（80〜120字）"
      }
    ]
  },
  "weatherFashion": {
    "title": "天気と服装",
    "weather": "晴れ時々くもり",
    "tempHigh": "18",
    "tempLow": "9",
    "rain": "10%",
    "advice": "天気に合わせたファッション提案（100〜150字）",
    "tip": "ワンポイントアドバイス（30〜50字）"
  },
  "culture": {
    "title": "催事",
    "items": [
      {
        "type": "展示会 or 映画",
        "title": "タイトル",
        "venue": "場所",
        "period": "期間",
        "description": "一言紹介（30〜50字）",
        "recommended": true
      }
    ]
  }
}

制約:
- articles配列は5件ちょうど。硬いニュース（政治/経済/国際/総合）3件 + 柔らかいニュース（文化/エンタメ/暮らし/スポーツ/テクノロジー）2件のバランスにする
- articles: 5件中2〜3件にimageKeywordを付与し、残りはnullにする。視覚的にイメージしやすい記事（スポーツ、災害、テクノロジー製品、建造物等）を優先。imageKeywordは記事に登場する具体的な被写体（建物、場所、機器、人物の動作など）を英語2〜4語で表す。「AI」「economy」などの抽象語だけのキーワードは避け、写真に写りうる物理的対象を指定する。日本のニュースならjapan/tokyo等の地域キーワードを含める
- numbers配列は5件。各記事やニュースから象徴的な数字を1つ抽出し、numberは数字+単位の簡潔な表記（例: "13万人", "3.2%", "1兆2000億円"）、labelは20字以内の説明
- ticker配列は6件（日経平均, TOPIX, ドル円, NYダウ, S&P500, BTC）
- tickerの数値はニュース一覧から推測できなければモック値でよい
- コラムは具体的なニュースに言及しつつ、哲学的・文学的な深みを持たせる
- headline.imageKeywordは記事の場面を撮影した報道写真のような画像を検索するためのキーワード。英語2〜4語で、写真に写る物理的対象を具体的に指定する（例: speed skating rink athlete, electric vehicle assembly line）。日本のニュースならjapan/tokyoなど地域キーワードを含める
- snsTrend: X（Twitter）トレンド3〜5件＋YouTube急上昇2〜3件。platformは"X"または"YouTube"。各itemにtopic（見出し）とdescription（なぜ話題か1〜2文）とurl（リンク先）。ネット文化に詳しい記者のトーンで。ニュース一覧から推測できるSNSの反応や、一般的に話題になりそうなトピックを取り上げる。urlはXの場合 https://x.com/search?q=%23キーワード（URLエンコード済み）、YouTubeの場合 https://www.youtube.com/results?search_query=キーワード（URLエンコード済み）の形式で生成する
- snsTrend.flame: ネット上で炎上中のトピックがあれば1件掲載する。企業の不祥事、著名人の失言、政策への批判など。topic（炎上トピック名）、description（何が問題か2〜3文、100〜150字）、url（Xの検索URL）。炎上と呼べるほどの話題がなければflameフィールドごとnullにする。事実ベースで中立的なトーンを保ち、過度な煽りは避ける
- heartwarming: 新聞の最後を飾る心温まる小さなニュース。動物の癒しエピソード、善意の話、子どもの面白い一言、季節の小さな発見など。短くても印象に残る、温かみのある文体で。事実に基づきつつ読み物として楽しめるように200〜300字で
- localNews: 渋谷区エリアのローカル情報3〜4件。新店オープン・閉店、地域イベント、再開発・工事情報、行列店や季節の風景など。住民目線の温かみのあるトーンで、各記事はtitle（見出し）とbody（本文2〜3文）。areaは"渋谷区"固定
- weatherFashion: 今日の東京の天気に合わせた服装提案。weather（天気）、tempHigh/tempLow（最高/最低気温）、rain（降水確率）は現実的な値を推測で生成。advice（服装提案100〜150字）は具体的なアイテム名を含める。tip（ワンポイント30〜50字）は折りたたみ傘・日焼け止め・花粉対策など実用的な助言
- culture: 東京都内の催事情報。展示会2〜3件＋映画1〜2件。各itemにtype（"展示会"or"映画"）、title、venue（場所）、period（期間）、description（一言紹介30〜50字）、recommended（おすすめならtrue、それ以外false）。実在する施設名を使い、期間は現実的に設定する
- JSONのみ出力。マークダウンのコードブロック(\`\`\`)で囲まないこと`;

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
