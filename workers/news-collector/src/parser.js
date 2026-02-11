/**
 * RSS/RDF XMLパーサー
 * Cloudflare Workers環境ではDOMParserが使えないため、
 * 正規表現ベースの軽量パーサーで処理する。
 */

/**
 * XMLテキストからタグの中身を取得
 */
function getTagContent(xml, tagName) {
  // CDATA対応（複数CDATAセクションにも対応）
  const cdataRegex = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tagName}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // 通常のタグ（ネストなし）
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * content:encoded等のリッチHTML内容からプレーンテキストを抽出
 */
function extractTextFromHtml(html) {
  if (!html) return '';
  // blockquote, cite, img等すべてのタグを除去
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * RSS 2.0形式をパース
 */
function parseRSS2(xml, source) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = getTagContent(itemXml, 'title');
    const link = getTagContent(itemXml, 'link');
    const description = getTagContent(itemXml, 'description');
    const pubDate = getTagContent(itemXml, 'pubDate');

    if (title) {
      items.push({
        title: decodeEntities(title),
        summary: decodeEntities(stripHtml(description)).slice(0, 200),
        source: source.name,
        category: source.category,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
        url: link,
      });
    }
  }

  return items;
}

/**
 * RDF/RSS 1.0形式をパース（はてなブックマーク等）
 */
function parseRDF(xml, source) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = getTagContent(itemXml, 'title');
    const link = getTagContent(itemXml, 'link');
    const description = getTagContent(itemXml, 'description') ||
                        getTagContent(itemXml, 'dc:description') ||
                        getTagContent(itemXml, 'content:encoded');
    const pubDate = getTagContent(itemXml, 'dc:date') ||
                    getTagContent(itemXml, 'pubDate');

    if (title) {
      const rawSummary = extractTextFromHtml(decodeEntities(description));
      items.push({
        title: decodeEntities(title),
        summary: rawSummary.slice(0, 200),
        source: source.name,
        category: source.category,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
        url: link,
      });
    }
  }

  return items;
}

/**
 * HTMLタグを除去
 */
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * HTML entityをデコード
 */
function decodeEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

/**
 * フィードをフェッチしてパース
 */
export async function fetchAndParseFeed(source) {
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'GeneratedNews/1.0 (news-collector)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    if (!response.ok) {
      console.error(`Feed fetch failed: ${source.name} (${response.status})`);
      return [];
    }

    const xml = await response.text();

    if (source.format === 'rdf') {
      return parseRDF(xml, source);
    }
    return parseRSS2(xml, source);
  } catch (error) {
    console.error(`Feed parse error: ${source.name}`, error.message);
    return [];
  }
}
