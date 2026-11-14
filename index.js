export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // On écoute uniquement les requêtes POST sur /ping
    if (request.method === "POST" && url.pathname === "/ping") {
      const appVersion = url.searchParams.get("app_v") || "unknown";
      const osVersion = url.searchParams.get("os_v") || "unknown";
      const today = new Date().toISOString().split('T')[0]; // Format "AAAA-MM-JJ"

      // Récupère ou crée la ligne du jour dans la base D1
      let row = await env.DB.prepare("SELECT * FROM daily_stats WHERE date = ?").bind(today).first();

      let total = row ? row.total_pings + 1 : 1;
      
      // Mise à jour de la base de données
      if (row) {
        await env.DB.prepare("UPDATE daily_stats SET total_pings = ? WHERE date = ?").bind(total, today).run();
      } else {
        await env.DB.prepare("INSERT INTO daily_stats (date, total_pings) VALUES (?, ?)").bind(today, 1).run();
      }

      return new Response(null, { status: 204 }); // Réponse vide ultra légère
    }

    return new Response("Not found", { status: 404 });
  }
};
