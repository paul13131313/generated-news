/**
 * Claude API クライアント
 * Cloudflare Workers環境用（fetch API利用）
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 6000;

/**
 * Claude APIを呼び出して紙面JSONを生成
 */
export async function callClaude(apiKey, systemPrompt, userPrompt) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorBody}`);
  }

  const result = await response.json();

  // usage情報をログ
  if (result.usage) {
    const inputCost = (result.usage.input_tokens / 1_000_000) * 1.00;
    const outputCost = (result.usage.output_tokens / 1_000_000) * 5.00;
    const totalCost = inputCost + outputCost;
    const yenCost = totalCost * 150; // ドル円概算
    console.log(`Claude usage: in=${result.usage.input_tokens} out=${result.usage.output_tokens} cost≈$${totalCost.toFixed(4)} (≈${yenCost.toFixed(1)}円)`);
  }

  // テキストコンテンツを抽出
  const textBlock = result.content?.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('Claude returned no text content');
  }

  return textBlock.text;
}

/**
 * Claude応答テキストからJSONをパース
 * コードブロック囲み等にも対応
 */
export function parseGeneratedJson(text) {
  // ```json ... ``` を除去
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // JSONの部分だけを抽出して再試行
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Failed to parse generated JSON: ${e.message}\nRaw: ${cleaned.slice(0, 500)}`);
  }
}
