import { useState } from "react";

const COLORS = {
  bg: "#f5f0eb",
  dark: "#1a1a1a",
  accent: "#c43e2a",
  blue: "#2a5c8f",
  green: "#2a7a4f",
  purple: "#6b4c8f",
  orange: "#b8650a",
  muted: "#8a8278",
  line: "#c4bdb4",
  cardBg: "#fff",
  kvBg: "#faf7f3",
};

const Box = ({ x, y, w, h, label, sub, color = COLORS.dark, icon, small, onClick, active }) => (
  <g
    onClick={onClick}
    style={{ cursor: onClick ? "pointer" : "default" }}
  >
    <rect
      x={x} y={y} width={w} height={h} rx={3}
      fill={active ? color : COLORS.cardBg}
      stroke={color} strokeWidth={active ? 2 : 1.2}
      filter={active ? "url(#activeShadow)" : "url(#softShadow)"}
    />
    {icon && (
      <text x={x + w / 2} y={y + (small ? 16 : 20)} textAnchor="middle"
        style={{ fontSize: small ? 12 : 14 }}>{icon}</text>
    )}
    <text x={x + w / 2} y={y + (icon ? (small ? 28 : 35) : (small ? 18 : h / 2 - 4))}
      textAnchor="middle"
      style={{
        fontSize: small ? 9 : 11,
        fontWeight: 700,
        fill: active ? "#fff" : color,
        fontFamily: "'Noto Sans JP', sans-serif",
        letterSpacing: "0.02em",
      }}>{label}</text>
    {sub && (
      <text x={x + w / 2} y={y + (icon ? (small ? 38 : 47) : (small ? 28 : h / 2 + 11))}
        textAnchor="middle"
        style={{
          fontSize: small ? 7.5 : 8.5,
          fill: active ? "rgba(255,255,255,0.8)" : COLORS.muted,
          fontFamily: "'Noto Sans JP', sans-serif",
        }}>{sub}</text>
    )}
  </g>
);

const Arrow = ({ x1, y1, x2, y2, dashed, color = COLORS.line, label }) => {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const isVertical = Math.abs(dy) > Math.abs(dx);

  let path;
  if (isVertical) {
    const curveY = y1 + (y2 - y1) * 0.5;
    path = `M${x1},${y1} C${x1},${curveY} ${x2},${curveY} ${x2},${y2}`;
  } else {
    const curveX = x1 + (x2 - x1) * 0.5;
    path = `M${x1},${y1} C${curveX},${y1} ${curveX},${y2} ${x2},${y2}`;
  }

  return (
    <g>
      <path d={path} fill="none" stroke={color} strokeWidth={1.2}
        strokeDasharray={dashed ? "4,3" : "none"}
        markerEnd="url(#arrowhead)" />
      {label && (
        <text x={midX} y={midY - 5} textAnchor="middle"
          style={{ fontSize: 7, fill: COLORS.muted, fontFamily: "'Noto Sans JP', sans-serif" }}>
          {label}
        </text>
      )}
    </g>
  );
};

const SectionLabel = ({ x, y, label, color = COLORS.dark }) => (
  <g>
    <line x1={x} y1={y + 10} x2={x + 4} y2={y + 10} stroke={color} strokeWidth={2} />
    <text x={x + 8} y={y + 14}
      style={{
        fontSize: 10,
        fontWeight: 700,
        fill: color,
        fontFamily: "'Noto Serif JP', serif",
        letterSpacing: "0.15em",
      }}>{label}</text>
  </g>
);

const details = {
  frontend: {
    title: "フロントエンド",
    desc: "GitHub Pages で静的ホスティング。PWA対応（ServiceWorker v5）でオフライン閲覧可能。Google Analytics GA4 でアクセス解析。",
    items: ["index.html — 新聞紙面", "lp.html — ランディングページ", "ogp.html — OGP/Twitterカード", "sw.js — ServiceWorker (PWA)"],
  },
  collector: {
    title: "news-collector",
    desc: "RSS 15フィード × 10カテゴリからニュースを収集。Cron トリガーで定期実行。",
    items: ["15 RSSフィード自動巡回", "10カテゴリ分類", "news-generator へ記事データ送信"],
  },
  generator: {
    title: "news-generator",
    desc: "Claude Haiku 4.5 で紙面JSONを生成。Cron 06:00/17:00 JST。Unsplash写真連携。",
    items: ["Claude API で記事要約・生成", "Unsplash API で写真取得", "KV に紙面キャッシュ保存", "Push API 経由で通知配信"],
  },
  auth: {
    title: "auth-api",
    desc: "ユーザー認証（PBKDF2ハッシュ）。プロファイル管理（カテゴリ10種 + キーワード最大10個）。",
    items: ["サインアップ / ログイン / ログアウト", "PBKDF2 パスワードハッシュ", "セッション管理（30日TTL）", "関心プロファイル管理"],
  },
  payment: {
    title: "payment-api",
    desc: "Stripe本番モード。月額300円サブスク + 初月無料。Webhook で購読状態同期。招待パス（Invite Pass）対応。",
    items: ["Stripe Checkout セッション作成", "Webhook (invoice.paid等) 処理", "購読者ステータス管理", "招待コード検証 + 7日間体験"],
  },
  push: {
    title: "push-api",
    desc: "Web Push通知。VAPID/RFC 8291暗号化。紙面生成完了時に自動配信。",
    items: ["VAPID鍵ペア管理", "購読登録/解除", "生成完了→全購読者に一斉配信"],
  },
  waitlist: {
    title: "waitlist-api",
    desc: "LP からのウェイトリスト登録を管理。",
    items: ["メールアドレス登録", "重複チェック"],
  },
  kv: {
    title: "Cloudflare KV（6個）",
    desc: "全データをCloudflare KV Namespaceで管理。サーバーレスで低コスト運用。",
    items: [
      "NEWSPAPER_CACHE — 紙面キャッシュ(12h TTL)",
      "USERS — ユーザーデータ+プロファイル",
      "SESSIONS — セッション(30日TTL)",
      "SUBSCRIBERS — Stripe購読者",
      "WAITLIST — ウェイトリスト",
      "PUSH_SUBSCRIPTIONS — Push通知購読",
    ],
  },
  external: {
    title: "外部サービス",
    desc: "AI生成、写真取得、決済の3つの外部APIと連携。",
    items: [
      "Claude API (Haiku 4.5) — AI紙面生成",
      "Unsplash API — 記事写真",
      "Stripe API — 決済・サブスク管理",
      "RSS Feeds (15サイト) — ニュースソース",
    ],
  },
};

export default function ArchitectureDiagram() {
  const [selected, setSelected] = useState(null);
  const info = selected ? details[selected] : null;

  return (
    <div style={{
      minHeight: "100vh",
      background: COLORS.bg,
      fontFamily: "'Noto Sans JP', 'Helvetica Neue', sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "32px 16px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&family=Noto+Serif+JP:wght@700;900&display=swap" rel="stylesheet" />

      <h1 style={{
        fontFamily: "'Noto Serif JP', serif",
        fontSize: 28,
        fontWeight: 900,
        color: COLORS.dark,
        letterSpacing: "0.15em",
        marginBottom: 4,
      }}>生 成 新 聞</h1>
      <p style={{
        fontSize: 12,
        color: COLORS.muted,
        letterSpacing: "0.3em",
        marginBottom: 6,
      }}>SYSTEM ARCHITECTURE</p>
      <p style={{
        fontSize: 11,
        color: COLORS.muted,
        marginBottom: 28,
      }}>各ボックスをクリックで詳細表示</p>

      <svg viewBox="0 0 860 520" style={{ width: "100%", maxWidth: 860 }}>
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={COLORS.line} />
          </marker>
          <filter id="softShadow" x="-4%" y="-4%" width="108%" height="112%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.06" />
          </filter>
          <filter id="activeShadow" x="-4%" y="-4%" width="108%" height="112%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.15" />
          </filter>
        </defs>

        {/* Background zones */}
        <rect x={10} y={30} width={840} height={72} rx={4} fill="rgba(42,92,143,0.04)" stroke="rgba(42,92,143,0.12)" strokeWidth={0.8} strokeDasharray="4,3" />
        <rect x={10} y={130} width={840} height={195} rx={4} fill="rgba(196,62,42,0.03)" stroke="rgba(196,62,42,0.1)" strokeWidth={0.8} strokeDasharray="4,3" />
        <rect x={10} y={353} width={420} height={155} rx={4} fill="rgba(42,122,79,0.04)" stroke="rgba(42,122,79,0.1)" strokeWidth={0.8} strokeDasharray="4,3" />
        <rect x={445} y={353} width={405} height={155} rx={4} fill="rgba(107,76,143,0.04)" stroke="rgba(107,76,143,0.1)" strokeWidth={0.8} strokeDasharray="4,3" />

        {/* Section labels */}
        <SectionLabel x={16} y={22} label="フロントエンド" color={COLORS.blue} />
        <SectionLabel x={16} y={122} label="バックエンド — Cloudflare Workers ×6" color={COLORS.accent} />
        <SectionLabel x={16} y={345} label="データストア — Cloudflare KV ×6" color={COLORS.green} />
        <SectionLabel x={451} y={345} label="外部サービス" color={COLORS.purple} />

        {/* ── Frontend ── */}
        <Box x={30} y={46} w={160} h={48} label="GitHub Pages" sub="index.html / lp.html / PWA"
          icon="📰" color={COLORS.blue} onClick={() => setSelected("frontend")} active={selected === "frontend"} />
        <Box x={230} y={46} w={100} h={48} label="ユーザー" icon="👤" color={COLORS.blue}
          small />
        <Arrow x1={230} y1={70} x2={190} y2={70} label="閲覧" />

        {/* GA4 */}
        <Box x={370} y={46} w={90} h={48} label="GA4" sub="アクセス解析" icon="📊" color={COLORS.blue} small />
        <Arrow x1={190} y1={58} x2={370} y2={58} dashed label="" />

        {/* ── Backend Workers ── */}
        {/* news-collector */}
        <Box x={30} y={150} w={140} h={55} label="news-collector" sub="RSS 15フィード収集"
          icon="📡" color={COLORS.accent} onClick={() => setSelected("collector")} active={selected === "collector"} />

        {/* news-generator */}
        <Box x={195} y={150} w={150} h={55} label="news-generator" sub="Cron 06:00 / 17:00 JST"
          icon="🤖" color={COLORS.accent} onClick={() => setSelected("generator")} active={selected === "generator"} />

        {/* auth-api */}
        <Box x={370} y={150} w={130} h={55} label="auth-api" sub="認証 / プロファイル"
          icon="🔐" color={COLORS.accent} onClick={() => setSelected("auth")} active={selected === "auth"} />

        {/* payment-api */}
        <Box x={525} y={150} w={140} h={55} label="payment-api" sub="Stripe決済 / 招待パス"
          icon="💳" color={COLORS.accent} onClick={() => setSelected("payment")} active={selected === "payment"} />

        {/* push-api */}
        <Box x={690} y={150} w={140} h={55} label="push-api" sub="Web Push通知"
          icon="🔔" color={COLORS.accent} onClick={() => setSelected("push")} active={selected === "push"} />

        {/* waitlist-api */}
        <Box x={370} y={250} w={130} h={50} label="waitlist-api" sub="ウェイトリスト"
          icon="📝" color={COLORS.accent} onClick={() => setSelected("waitlist")} active={selected === "waitlist"} small />

        {/* Worker connections */}
        <Arrow x1={170} y1={178} x2={195} y2={178} label="記事データ" />
        <Arrow x1={270} y1={205} x2={270} y2={240} color={COLORS.accent} label="" />
        <text x={280} y={228} style={{ fontSize: 7, fill: COLORS.muted }}>KV保存</text>

        {/* Frontend → Workers */}
        <Arrow x1={110} y1={94} x2={110} y2={150} dashed color={COLORS.blue} />
        <Arrow x1={200} y1={94} x2={435} y2={150} dashed color={COLORS.blue} />
        <Arrow x1={160} y1={94} x2={595} y2={150} dashed color={COLORS.blue} />

        {/* ── KV Stores ── */}
        <Box x={30} y={375} w={120} h={42} label="NEWSPAPER_CACHE" sub="紙面 12h TTL"
          color={COLORS.green} onClick={() => setSelected("kv")} active={selected === "kv"} small />
        <Box x={160} y={375} w={80} h={42} label="USERS" sub="ユーザー"
          color={COLORS.green} onClick={() => setSelected("kv")} active={selected === "kv"} small />
        <Box x={250} y={375} w={85} h={42} label="SESSIONS" sub="30日TTL"
          color={COLORS.green} onClick={() => setSelected("kv")} active={selected === "kv"} small />
        <Box x={30} y={440} w={105} h={42} label="SUBSCRIBERS" sub="Stripe購読者"
          color={COLORS.green} onClick={() => setSelected("kv")} active={selected === "kv"} small />
        <Box x={145} y={440} w={90} h={42} label="WAITLIST" sub="ウェイトリスト"
          color={COLORS.green} onClick={() => setSelected("kv")} active={selected === "kv"} small />
        <Box x={245} y={440} w={140} h={42} label="PUSH_SUBSCRIPTIONS" sub="Push通知購読"
          color={COLORS.green} onClick={() => setSelected("kv")} active={selected === "kv"} small />

        {/* Workers → KV arrows */}
        <Arrow x1={270} y1={248} x2={90} y2={375} color={COLORS.green} />
        <Arrow x1={435} y1={205} x2={200} y2={375} color={COLORS.green} />
        <Arrow x1={435} y1={205} x2={292} y2={375} color={COLORS.green} />
        <Arrow x1={595} y1={205} x2={82} y2={440} color={COLORS.green} />
        <Arrow x1={435} y1={300} x2={190} y2={440} color={COLORS.green} />
        <Arrow x1={760} y1={205} x2={315} y2={440} color={COLORS.green} />

        {/* ── External Services ── */}
        <Box x={470} y={375} w={130} h={50} label="Claude API" sub="Haiku 4.5 — AI生成"
          icon="🧠" color={COLORS.purple} onClick={() => setSelected("external")} active={selected === "external"} small />
        <Box x={615} y={375} w={110} h={50} label="Unsplash" sub="記事写真"
          icon="📷" color={COLORS.purple} onClick={() => setSelected("external")} active={selected === "external"} small />
        <Box x={740} y={375} w={90} h={50} label="Stripe" sub="決済"
          icon="💰" color={COLORS.purple} onClick={() => setSelected("external")} active={selected === "external"} small />
        <Box x={470} y={445} w={130} h={42} label="RSS Feeds" sub="15サイト — ニュースソース"
          icon="📡" color={COLORS.purple} onClick={() => setSelected("external")} active={selected === "external"} small />

        {/* Workers → External */}
        <Arrow x1={270} y1={205} x2={535} y2={375} color={COLORS.purple} label="AI生成" />
        <Arrow x1={300} y1={205} x2={670} y2={375} color={COLORS.purple} />
        <Arrow x1={595} y1={205} x2={785} y2={375} color={COLORS.purple} />
        <Arrow x1={100} y1={205} x2={535} y2={445} color={COLORS.purple} />
      </svg>

      {/* Detail panel */}
      <div style={{
        width: "100%",
        maxWidth: 860,
        minHeight: 140,
        marginTop: 20,
        background: info ? COLORS.cardBg : "transparent",
        border: info ? `1px solid ${COLORS.line}` : "1px solid transparent",
        borderRadius: 4,
        padding: info ? 24 : 0,
        transition: "all 0.2s ease",
      }}>
        {info ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{
                fontFamily: "'Noto Serif JP', serif",
                fontSize: 18,
                fontWeight: 700,
                color: COLORS.dark,
                margin: 0,
              }}>{info.title}</h2>
              <button onClick={() => setSelected(null)} style={{
                background: "none", border: "none", fontSize: 18, color: COLORS.muted,
                cursor: "pointer", padding: "0 4px",
              }}>×</button>
            </div>
            <p style={{
              fontSize: 13,
              color: COLORS.dark,
              margin: "10px 0 14px",
              lineHeight: 1.7,
            }}>{info.desc}</p>
            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}>
              {info.items.map((item, i) => (
                <span key={i} style={{
                  fontSize: 11,
                  color: COLORS.dark,
                  background: COLORS.kvBg,
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 3,
                  padding: "5px 10px",
                  lineHeight: 1.4,
                }}>{item}</span>
              ))}
            </div>
          </>
        ) : (
          <p style={{
            fontSize: 12,
            color: COLORS.muted,
            textAlign: "center",
            padding: 20,
          }}>↑ 各ボックスをクリックすると詳細が表示されます</p>
        )}
      </div>

      <p style={{
        fontSize: 10,
        color: COLORS.muted,
        marginTop: 24,
        letterSpacing: "0.1em",
      }}>生成新聞 — paul13131313.github.io/generated-news — 2026.02</p>
    </div>
  );
}
