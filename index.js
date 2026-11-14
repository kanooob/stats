export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Route de réception des pings (POST /ping)
    if (request.method === "POST" && url.pathname === "/ping") {
      const appVersion = url.searchParams.get("app_v") || "unknown";
      const osVersion = url.searchParams.get("os_v") || "unknown";
      const today = new Date().toISOString().split('T')[0]; // Format "AAAA-MM-JJ"

      // Récupère la ligne du jour dans la base D1
      let row = await env.DB.prepare("SELECT * FROM daily_stats WHERE date = ?")
        .bind(today)
        .first();

      if (row) {
        // Incrémente le total
        const total = row.total_pings + 1;

        // Parse les JSON existants (ou initialise des objets vides si null)
        const versions = row.versions ? JSON.parse(row.versions) : {};
        const androidVersions = row.android_versions ? JSON.parse(row.android_versions) : {};

        // Incrémente le compteur pour la version de l'app et d'Android reçues
        versions[appVersion] = (versions[appVersion] || 0) + 1;
        androidVersions[osVersion] = (androidVersions[osVersion] || 0) + 1;

        await env.DB.prepare(
          "UPDATE daily_stats SET total_pings = ?, versions = ?, android_versions = ? WHERE date = ?"
        )
          .bind(total, JSON.stringify(versions), JSON.stringify(androidVersions), today)
          .run();
      } else {
        // Première entrée de la journée
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

    // 2. Route de consultation rapide (GET /stats)
    if (request.method === "GET" && url.pathname === "/stats") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM daily_stats ORDER BY date DESC LIMIT 30"
      ).all();

      // Formate proprement les champs JSON pour la lecture
      const formatted = results.map(row => ({
        date: row.date,
        total_pings: row.total_pings,
        versions: row.versions ? JSON.parse(row.versions) : {},
        android_versions: row.android_versions ? JSON.parse(row.android_versions) : {}
      }));

      return Response.json(formatted);
    }

    return new Response("Not found", { status: 404 });
  }
};
