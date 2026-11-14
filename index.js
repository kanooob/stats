const WEBHOOKS = {
  hebdo: "https://discord.com/api/webhooks/1571171964385755136/EkHvEszquKC83ml86wzLx1e8jQ3wikToGso7c_IL9akhe687aEcsySzAZFsalYwjOOC9",
  mensuel: "https://discord.com/api/webhooks/1571172099328970753/yRGc35VddYTK1-1mXKe8bbZqIoW-ZGHorDqoUj4OCe8TzolO2RCdDe-wc8r3lbbl0RX0",
  annuel: "https://discord.com/api/webhooks/1571171843262521455/KGOF7wXKPTxB2duwI_7sBhRQS4dHGHSz58ZQ_Fezd2YuNBU92MD_i4njrHV1jD6qhL_G"
};

export default {
  // 1. Gestion des requêtes HTTP de l'application (/ping et /stats)
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/ping") {
      const appVersion = url.searchParams.get("app_v") || "unknown";
      const osVersion = url.searchParams.get("os_v") || "unknown";
      const today = new Date().toISOString().split('T')[0];

      let row = await env.DB.prepare("SELECT * FROM daily_stats WHERE date = ?")
        .bind(today)
        .first();

      if (row) {
        const total = row.total_pings + 1;
        const versions = row.versions ? JSON.parse(row.versions) : {};
        const androidVersions = row.android_versions ? JSON.parse(row.android_versions) : {};

        versions[appVersion] = (versions[appVersion] || 0) + 1;
        androidVersions[osVersion] = (androidVersions[osVersion] || 0) + 1;

        await env.DB.prepare(
          "UPDATE daily_stats SET total_pings = ?, versions = ?, android_versions = ? WHERE date = ?"
        )
          .bind(total, JSON.stringify(versions), JSON.stringify(androidVersions), today)
          .run();
      } else {
        const versions = { [appVersion]: 1 };
        const androidVersions = { [osVersion]: 1 };

        await env.DB.prepare(
          "INSERT INTO daily_stats (date, total_pings, versions, android_versions) VALUES (?, ?, ?, ?)"
        )
          .bind(today, 1, JSON.stringify(versions), JSON.stringify(androidVersions))
          .run();
      }

      return new Response(null, { status: 204 });
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM daily_stats ORDER BY date DESC LIMIT 30"
      ).all();

      const formatted = results.map(row => ({
        date: row.date,
        total_pings: row.total_pings,
        versions: row.versions ? JSON.parse(row.versions) : {},
        android_versions: row.android_versions ? JSON.parse(row.android_versions) : {}
      }));

      return Response.json(formatted);
    }

    return new Response("Not found", { status: 404 });
  },

  // 2. Exécution automatique via Cron Triggers
  async scheduled(event, env, ctx) {
    let type = "hebdo";
    if (event.cron === "5 8 1 * *") type = "mensuel";
    if (event.cron === "10 8 1 1 *") type = "annuel";

    ctx.waitUntil(sendRecap(env, type));
  }
};

// --- Fonctions de calcul et d'envoi Discord ---

async function sendRecap(env, type) {
  const days = type === "hebdo" ? 7 : type === "mensuel" ? 30 : 365;
  const title = type === "hebdo" ? "📊 Récapitulatif Hebdomadaire (7j)" 
              : type === "mensuel" ? "📅 Récapitulatif Mensuel (30j)" 
              : "🎉 Récapitulatif Annuel (365j)";

  const currentStats = await getPeriodStats(env, `-${days} days`, "now");
  const previousStats = await getPeriodStats(env, `-${days * 2} days`, `-${days} days`);

  const pingEvolution = formatEvolution(currentStats.totalPings, previousStats.totalPings);
  const dauEvolution = formatEvolution(currentStats.avgDau, previousStats.avgDau);

  const appVersionsText = formatBreakdown(currentStats.versions, currentStats.totalPings);
  const androidVersionsText = formatBreakdown(currentStats.androidVersions, currentStats.totalPings);

  const payload = {
    embeds: [
      {
        title: title,
        color: 0x8C935D,
        fields: [
          {
            name: "👥 Utilisateurs actifs / jour (Moyenne)",
            value: `**${currentStats.avgDau}** (${dauEvolution})\n*Pic max : ${currentStats.maxDau} utilisateurs sur une journée*`,
            inline: false
          },
          {
            name: "📈 Activité totale (Pings cumulés)",
            value: `**${currentStats.totalPings}** (${pingEvolution})`,
            inline: false
          },
          {
            name: "📱 Versions de l'application",
            value: appVersionsText || "Aucune donnée",
            inline: true
          },
          {
            name: "🤖 Versions Android",
            value: androidVersionsText || "Aucune donnée",
            inline: true
          }
        ],
        footer: {
          text: `Comparaison par rapport aux ${days} jours précédents`
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  await fetch(WEBHOOKS[type], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function getPeriodStats(env, startOffset, endOffset) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM daily_stats WHERE date >= date('now', ?) AND date < date('now', ?)"
  )
    .bind(startOffset, endOffset)
    .all();

  let totalPings = 0;
  let maxDau = 0;
  const versions = {};
  const androidVersions = {};

  for (const row of results) {
    totalPings += row.total_pings;
    if (row.total_pings > maxDau) maxDau = row.total_pings;

    const vObj = row.versions ? JSON.parse(row.versions) : {};
    for (const [k, v] of Object.entries(vObj)) {
      versions[k] = (versions[k] || 0) + v;
    }

    const osObj = row.android_versions ? JSON.parse(row.android_versions) : {};
    for (const [k, v] of Object.entries(osObj)) {
      androidVersions[k] = (androidVersions[k] || 0) + v;
    }
  }

  const activeDays = results.length || 1;
  const avgDau = Math.round((totalPings / activeDays) * 10) / 10;

  return { totalPings, avgDau, maxDau, versions, androidVersions };
}

function formatEvolution(current, previous) {
  if (previous === 0) return current > 0 ? "🆕 Première période" : "➖ 0%";
  const diff = ((current - previous) / previous) * 100;
  const sign = diff > 0 ? "+" : "";
  const icon = diff > 0 ? "📈" : diff < 0 ? "📉" : "➖";
  return `${icon} ${sign}${diff.toFixed(1)}%`;
}

function formatBreakdown(obj, total) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;

  return entries
    .slice(0, 6)
    .map(([key, count]) => {
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return `• **${key}** : ${pct}% (${count})`;
    })
    .join("\n");
}
