/**
 * Zorts Tournament Scraper — Cloudflare Worker with Cron Trigger
 *
 * Scrapes public bracket/schedule data from zortssports.com for configured
 * tournaments and writes parsed game state to KV for the FAF site ticker.
 *
 * Three-step session flow per division:
 *   1. GET /post/clubHouse?tid=<tid>  — establishes session cookie
 *   2. POST /zorts/changeFilter       — selects division + team filter
 *   3. GET /calendar/index?teamId=<teamId> — returns schedule HTML with scores
 *
 * KV keys written:
 *   tournament-config  — JSON config (tournament IDs, divisions, teams)
 *   tournament-status  — JSON status blob consumed by the frontend API
 */

const ZORTS_BASE = "https://www.zortssports.com";

// Workers have no DOM, so decode the small set of entities Zorts actually
// emits in team/opponent names (numeric entities like &#39; for apostrophes,
// plus the standard named ones) rather than pulling in a full HTML parser.
function decodeHtmlEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

const DEFAULT_CONFIG = {
  tournaments: [
    {
      tid: 26054,
      name: "SLCT Flag Summer Nationals",
      venue: "The Star / Keller Central HS",
      dates: "Aug 8-9, 2026",
      divisions: [
        {
          did: 96694,
          label: "Boy's 10U",
          teamId: 1307521,
          teamName: "Frisco Elite",
        },
        {
          did: 96693,
          label: "Boy's 9U",
          teamId: 1307522,
          teamName: "Frisco Elite",
        },
      ],
    },
  ],
};

// ── Session management ──

async function establishSession(tid) {
  const res = await fetch(`${ZORTS_BASE}/post/clubHouse?tid=${tid}`, {
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/SESSION=([^;]+)/);
  if (!match) {
    throw new Error(`No session cookie returned for tid=${tid}`);
  }
  // Consume body to avoid connection leak
  await res.text();
  return `SESSION=${match[1]}`;
}

async function selectDivision(cookie, did, teamId) {
  const body = new URLSearchParams({
    tab: "Calendar",
    lastAction: "index",
    lastController: "calendar",
    "division.id": String(did),
    subdivision: "",
    organization: String(teamId),
    site: "",
  });

  const res = await fetch(`${ZORTS_BASE}/zorts/changeFilter`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "manual",
  });
  // Consume body
  await res.text();
}

async function fetchCalendar(cookie, teamId) {
  const res = await fetch(`${ZORTS_BASE}/calendar/index?teamId=${teamId}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error("Session redirect — cookie likely invalid");
  }
  return res.text();
}

async function fetchStandings(cookie, did) {
  // Switch filter to standings view
  const body = new URLSearchParams({
    tab: "Standings",
    lastAction: "index",
    lastController: "standing",
    "division.id": String(did),
    subdivision: "",
    organization: "null",
    site: "",
  });

  await fetch(`${ZORTS_BASE}/zorts/changeFilter`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "manual",
  }).then((r) => r.text());

  const res = await fetch(`${ZORTS_BASE}/standing/index?did=${did}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  return res.text();
}

// ── HTML Parsing (no DOM parser in Workers — regex-based) ──

function parseCalendarHtml(html, teamName) {
  const games = [];

  // Extract only the calendarCore div to avoid noise
  const coreMatch = html.match(
    /<div\s+id="calendarCore"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  const calendarHtml = coreMatch ? coreMatch[1] : html;

  // Split by table rows
  const rows = calendarHtml.split(/<tr[\s>]/i);
  let currentDay = "";

  for (const row of rows) {
    // Day headers: <td style="..." colspan="4" ...><div style="...">Sat, Aug 8</div></td>
    // colspan may appear anywhere in the td attributes
    const dayMatch = row.match(
      /<td[^>]*colspan="4"[^>]*>[\s\S]*?<div[^>]*>\s*([^<]+?)\s*<\/div>/i,
    );
    if (dayMatch) {
      currentDay = dayMatch[1].trim();
      continue;
    }

    // Game rows contain opponent, score/time, field
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = tdRegex.exec(row)) !== null) {
      cells.push(m[1].trim());
    }

    if (cells.length < 3) continue;

    // Cell 0: opponent link — may have "@" prefix (away) or no prefix (home)
    // The <a> tag contains <img> then team name text, so strip tags to get name
    const hasLink = cells[0].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!hasLink) continue;

    const opponentRaw = decodeHtmlEntities(
      hasLink[1].replace(/<[^>]+>/g, "").trim(),
    );
    // Strip trailing division label (e.g. "Boy's 10U", "Girl's 12UG",
    // or "Boy's 9u to 10u" -- Zorts uses both formats depending on view)
    const opponent = opponentRaw
      .replace(/\s+(?:Boy|Girl)'s\s+\d+u(?:\s+to\s+\d+u)?[G]?$/i, "")
      .trim();
    const isAway = /^\s*@/.test(cells[0]);

    // Cell 1: score or time — content lives inside <span id="score_...">
    let score = null;
    let time = null;
    let result = null;

    const scoreContent = cells[1];

    // Check for actual scores: <span style="font-weight: bold">32, 0</span>
    const scoreMatch = scoreContent.match(
      /<span[^>]*font-weight:\s*bold[^>]*>\s*([\d]+)\s*,\s*([\d]+)\s*<\/span>/i,
    );
    if (scoreMatch) {
      const s1 = parseInt(scoreMatch[1], 10) || 0;
      const s2 = parseInt(scoreMatch[2], 10) || 0;
      // Bold span shows visitorScore, homeScore — map based on home/away
      score = isAway ? { team: s1, opponent: s2 } : { opponent: s1, team: s2 };

      // Result text follows the bold span: "Frisco Elite Win", "Tie", "Texas Heat Win"
      const afterBold = scoreContent.slice(
        scoreContent.indexOf(scoreMatch[0]) + scoreMatch[0].length,
      );
      const resultText = afterBold.replace(/<[^>]+>/g, "").trim();
      if (/\btie\b/i.test(resultText)) {
        result = "T";
      } else if (/\bwin\b/i.test(resultText)) {
        result = resultText.toLowerCase().includes(teamName.toLowerCase())
          ? "W"
          : "L";
      } else if (/\bloss\b/i.test(resultText)) {
        result = "L";
      }
    }

    if (!score) {
      // No score — look for scheduled time (e.g. "08:10 AM")
      const timeMatch = scoreContent.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (timeMatch) {
        time = timeMatch[1].trim();
      }
    }

    // Cell 2: field/court — <a href="maps...">KCHS 12</a>
    const fieldMatch = cells[2].match(/<a[^>]*>([^<]+)<\/a>/i);
    const field = fieldMatch
      ? fieldMatch[1].trim()
      : cells[2].replace(/<[^>]+>/g, "").trim();

    games.push({
      day: currentDay,
      opponent,
      isAway,
      score,
      time,
      result,
      field,
    });
  }

  return games;
}

function parseStandingsHtml(html, teamName) {
  // Find the team row in standings table
  const teamNameLower = teamName.toLowerCase();
  const rows = html.split(/<tr[\s>]/i);

  for (const row of rows) {
    if (!row.toLowerCase().includes(teamNameLower)) continue;

    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = tdRegex.exec(row)) !== null) {
      cells.push(m[1].replace(/<[^>]+>/g, "").trim());
    }

    // Standings columns: Place, Name, W, L, T, PF, PA, Diff
    if (cells.length >= 8) {
      return {
        place: parseInt(cells[0], 10) || null,
        wins: parseInt(cells[2], 10) || 0,
        losses: parseInt(cells[3], 10) || 0,
        ties: parseInt(cells[4], 10) || 0,
        pointsFor: parseInt(cells[5], 10) || 0,
        pointsAgainst: parseInt(cells[6], 10) || 0,
        diff: parseInt(cells[7], 10) || 0,
      };
    }
  }

  return null;
}

// ── Main scraper logic ──

async function scrapeDivision(tid, division) {
  const { did, teamId, teamName, label } = division;

  // Step 1: establish session
  const cookie = await establishSession(tid);

  // Step 2: select division + team filter for calendar
  await selectDivision(cookie, did, teamId);

  // Step 3: fetch calendar
  const calendarHtml = await fetchCalendar(cookie, teamId);
  const games = parseCalendarHtml(calendarHtml, teamName);

  // Step 4: fetch standings (need a fresh session since changeFilter is stateful)
  const cookie2 = await establishSession(tid);
  const standingsBody = new URLSearchParams({
    tab: "Standings",
    lastAction: "index",
    lastController: "standing",
    "division.id": String(did),
    subdivision: "",
    organization: "null",
    site: "",
  });

  await fetch(`${ZORTS_BASE}/zorts/changeFilter`, {
    method: "POST",
    headers: {
      Cookie: cookie2,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: standingsBody.toString(),
    redirect: "manual",
  }).then((r) => r.text());

  const standingsHtml = await fetch(`${ZORTS_BASE}/standing/index?did=${did}`, {
    headers: { Cookie: cookie2 },
    redirect: "manual",
  }).then((r) => r.text());

  const standings = parseStandingsHtml(standingsHtml, teamName);

  // Determine next game (first game without a score)
  const nextGame = games.find((g) => !g.score);
  const lastGame = [...games].reverse().find((g) => g.score);

  return {
    division: label,
    teamName,
    games,
    standings,
    nextGame: nextGame || null,
    lastGame: lastGame || null,
  };
}

async function scrapeAll(config) {
  const results = [];

  for (const tournament of config.tournaments) {
    const divisions = [];

    for (const div of tournament.divisions) {
      try {
        const data = await scrapeDivision(tournament.tid, div);
        divisions.push({ ...data, error: null });
      } catch (err) {
        divisions.push({
          division: div.label,
          teamName: div.teamName,
          games: [],
          standings: null,
          nextGame: null,
          lastGame: null,
          error: err.message,
        });
      }
    }

    results.push({
      tid: tournament.tid,
      name: tournament.name,
      venue: tournament.venue,
      dates: tournament.dates,
      divisions,
    });
  }

  return results;
}

// ── Worker entry point ──

export default {
  async scheduled(event, env, ctx) {
    // Load config from KV (fall back to default)
    let config;
    try {
      const stored = await env.FAF_KV.get("tournament-config", "json");
      config = stored || DEFAULT_CONFIG;
    } catch {
      config = DEFAULT_CONFIG;
    }

    try {
      const tournaments = await scrapeAll(config);

      const status = {
        tournaments,
        lastUpdated: new Date().toISOString(),
        source: "zortssports.com",
        error: null,
      };

      await env.FAF_KV.put("tournament-status", JSON.stringify(status), {
        expirationTtl: 3600, // expire after 1 hour if cron stops
      });
    } catch (err) {
      // Write error state but keep last-known-good data
      const existing = await env.FAF_KV.get("tournament-status", "json");
      if (existing) {
        existing.error = err.message;
        existing.lastError = new Date().toISOString();
        await env.FAF_KV.put("tournament-status", JSON.stringify(existing), {
          expirationTtl: 3600,
        });
      }
    }
  },

  // HTTP handler for manual trigger / health check
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const status = await env.FAF_KV.get("tournament-status", "json");
      return new Response(
        JSON.stringify({
          ok: true,
          lastUpdated: status?.lastUpdated || null,
          error: status?.error || null,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/trigger") {
      // Manual trigger — run the scraper
      await this.scheduled({}, env, ctx);
      const status = await env.FAF_KV.get("tournament-status", "json");
      return new Response(JSON.stringify(status, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/config") {
      if (request.method === "PUT") {
        const body = await request.json();
        await env.FAF_KV.put("tournament-config", JSON.stringify(body));
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      const config = await env.FAF_KV.get("tournament-config", "json");
      return new Response(JSON.stringify(config || DEFAULT_CONFIG, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("faf-zorts-scraper", { status: 200 });
  },
};
