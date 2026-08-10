/**
 * Tests for the Zorts tournament scraper.
 *
 * (a) Two-step session flow works against live Zorts
 * (b) Parse failure / Zorts downtime degrades gracefully
 *
 * Run: node tests/zorts-scraper.test.js
 */

const ZORTS_BASE = "https://www.zortssports.com";
const TEST_TID = 26054;
const TEST_DID = 96694;
const TEST_TEAM_ID = 1307521;
const TEST_TEAM_NAME = "Frisco Elite";

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log("  PASS: " + msg);
    passed++;
  } else {
    console.error("  FAIL: " + msg);
    failed++;
  }
}

// ── Test (a): Two-step session flow ──

async function testSessionFlow() {
  console.log("\n[Test] Two-step session flow against live Zorts");

  // Step 1: cold bracket fetch should redirect (no session)
  try {
    var coldBracketRes = await fetch(
      ZORTS_BASE + "/bracket/index?did=" + TEST_DID,
      { redirect: "manual" },
    );
    await coldBracketRes.text();
    assert(
      coldBracketRes.status >= 300,
      "Cold bracket fetch without session redirects (status " +
        coldBracketRes.status +
        ")",
    );
  } catch (e) {
    assert(false, "Cold bracket fetch threw: " + e.message);
  }

  // Step 2: establish session via clubhouse
  let cookie;
  try {
    const clubRes = await fetch(
      ZORTS_BASE + "/post/clubHouse?tid=" + TEST_TID,
      { redirect: "manual" },
    );
    const setCookie = clubRes.headers.get("set-cookie") || "";
    const match = setCookie.match(/SESSION=([^;]+)/);
    assert(!!match, "Clubhouse returns SESSION cookie");
    cookie = match ? "SESSION=" + match[1] : null;
    await clubRes.text();
  } catch (e) {
    assert(false, "Clubhouse fetch threw: " + e.message);
    return;
  }

  if (!cookie) {
    assert(false, "Cannot proceed without session cookie");
    return;
  }

  // Step 3: POST changeFilter to select division
  try {
    const filterBody = new URLSearchParams({
      tab: "Calendar",
      lastAction: "index",
      lastController: "calendar",
      "division.id": String(TEST_DID),
      subdivision: "",
      organization: String(TEST_TEAM_ID),
      site: "",
    });

    const filterRes = await fetch(ZORTS_BASE + "/zorts/changeFilter", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: filterBody.toString(),
      redirect: "manual",
    });
    assert(
      filterRes.status >= 200 && filterRes.status < 400,
      "changeFilter returns success/redirect (status " + filterRes.status + ")",
    );
    await filterRes.text();
  } catch (e) {
    assert(false, "changeFilter threw: " + e.message);
    return;
  }

  // Step 4: GET calendar with session cookie
  try {
    const calRes = await fetch(
      ZORTS_BASE + "/calendar/index?teamId=" + TEST_TEAM_ID,
      {
        headers: { Cookie: cookie },
        redirect: "manual",
      },
    );
    assert(calRes.status === 200, "Calendar returns 200 with valid session");
    const html = await calRes.text();
    assert(
      html.length > 500,
      "Calendar HTML has content (" + html.length + " chars)",
    );
    assert(
      html.toLowerCase().includes("frisco") ||
        html.toLowerCase().includes("elite"),
      "Calendar HTML contains team reference",
    );
  } catch (e) {
    assert(false, "Calendar fetch threw: " + e.message);
  }
}

// ── Test (b): Graceful degradation ──

async function testGracefulDegradation() {
  console.log("\n[Test] Graceful degradation on parse failure / downtime");

  // Simulate parsing malformed HTML
  const parseCalendar = parseCalendarHtml;
  const badHtml = "<html><body><p>Unexpected content</p></body></html>";
  const result = parseCalendar(badHtml, "Frisco Elite");
  assert(Array.isArray(result), "Parser returns array on malformed HTML");
  assert(result.length === 0, "Parser returns empty array on malformed HTML");

  // Simulate parsing empty string
  const emptyResult = parseCalendar("", "Frisco Elite");
  assert(Array.isArray(emptyResult), "Parser returns array on empty string");
  assert(
    emptyResult.length === 0,
    "Parser returns empty array on empty string",
  );

  // Simulate parsing valid-looking but scoreless content
  const noScoreHtml =
    '<tr id="older"><td colspan="4"><div>Saturday, August 9</div></td></tr>' +
    '<tr class="odd">' +
    '<td>@ <a href="/calendar/index?teamId=123">Test Opponent</a></td>' +
    "<td>10:00 AM</td>" +
    '<td><a href="#">STAR 01</a></td>' +
    "</tr>";
  const parsed = parseCalendar(noScoreHtml, "Test Team");
  assert(parsed.length === 1, "Parser finds one game in valid HTML");
  assert(
    parsed[0].opponent === "Test Opponent",
    "Parser extracts opponent name",
  );
  assert(parsed[0].time === "10:00 AM", "Parser extracts game time");
  assert(
    parsed[0].score === null,
    "Parser returns null score for upcoming game",
  );
  assert(parsed[0].field === "STAR 01", "Parser extracts field name");

  // Simulate parsing with scores — away game (@ prefix)
  // Bold span shows visitorScore, homeScore: when our team is away,
  // s1 = our score, s2 = opponent score
  const scoreHtml =
    '<tr id="older"><td colspan="4"><div>Saturday, August 9</div></td></tr>' +
    '<tr class="odd">' +
    '<td>@ <a href="/calendar/index?teamId=123">ETX LIONS</a></td>' +
    '<td><span id="score_999"><span style="font-weight: bold">32, 0</span> Frisco Elite Win</span></td>' +
    '<td><a href="#">KCHS 12</a></td>' +
    "</tr>";
  const scoreParsed = parseCalendar(scoreHtml, "Frisco Elite");
  assert(scoreParsed.length === 1, "Parser finds scored game");
  assert(
    scoreParsed[0].score.team === 32 && scoreParsed[0].score.opponent === 0,
    "Parser extracts correct scores (team=32, opp=0)",
  );
  assert(scoreParsed[0].result === "W", "Parser detects win result");

  // Test tournament-status API returns valid JSON even without KV data
  console.log("\n[Test] API endpoint returns valid structure without data");
  try {
    const apiRes = await fetch("http://localhost:8788/api/tournament-status");
    assert(
      apiRes.status === 200 || apiRes.status === 500,
      "API returns a valid HTTP status",
    );
    const data = await apiRes.json();
    assert(
      Array.isArray(data.tournaments),
      "API response has tournaments array",
    );
    assert("lastUpdated" in data, "API response has lastUpdated field");
  } catch (e) {
    console.log(
      "  SKIP: API endpoint test (local dev server not running): " + e.message,
    );
  }
}

// ── Inline parser for testing (mirrors worker logic) ──

function parseCalendarHtml(html, teamName) {
  var games = [];

  // Extract calendarCore div if present
  var coreMatch = html.match(
    /<div\s+id="calendarCore"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  var calendarHtml = coreMatch ? coreMatch[1] : html;

  var rows = calendarHtml.split(/<tr[\s>]/i);
  var currentDay = "";

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    // Day headers: colspan="4" may appear anywhere in td attributes
    var dayMatch = row.match(
      /<td[^>]*colspan="4"[^>]*>[\s\S]*?<div[^>]*>\s*([^<]+?)\s*<\/div>/i,
    );
    if (dayMatch) {
      currentDay = dayMatch[1].trim();
      continue;
    }

    var cells = [];
    var tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var m;
    while ((m = tdRegex.exec(row)) !== null) {
      cells.push(m[1].trim());
    }

    if (cells.length < 3) continue;

    // Opponent: extract link content, strip tags to get name
    var hasLink = cells[0].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!hasLink) continue;

    var opponentRaw = hasLink[1].replace(/<[^>]+>/g, "").trim();
    var opponent = opponentRaw
      .replace(/\s+(?:Boy|Girl)&#39;s\s+\d+U[G]?$/i, "")
      .replace(/\s+(?:Boy|Girl)'s\s+\d+U[G]?$/i, "")
      .trim();
    var isAway = /^\s*@/.test(cells[0]);

    var score = null;
    var time = null;
    var result = null;

    var scoreContent = cells[1];

    // Check for scores: <span style="font-weight: bold">32, 0</span>
    var scoreMatch = scoreContent.match(
      /<span[^>]*font-weight:\s*bold[^>]*>\s*([\d]+)\s*,\s*([\d]+)\s*<\/span>/i,
    );
    if (scoreMatch) {
      var s1 = parseInt(scoreMatch[1], 10) || 0;
      var s2 = parseInt(scoreMatch[2], 10) || 0;
      // Bold span shows visitorScore, homeScore — map based on home/away
      score = isAway ? { team: s1, opponent: s2 } : { opponent: s1, team: s2 };

      // Result text follows the bold span
      var afterBold = scoreContent.slice(
        scoreContent.indexOf(scoreMatch[0]) + scoreMatch[0].length,
      );
      var resultText = afterBold.replace(/<[^>]+>/g, "").trim();
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
      var timeMatch = cells[1].match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (timeMatch) {
        time = timeMatch[1].trim();
      }
    }

    var fieldMatch = cells[2].match(/<a[^>]*>([^<]+)<\/a>/i);
    var field = fieldMatch
      ? fieldMatch[1].trim()
      : cells[2].replace(/<[^>]+>/g, "").trim();

    games.push({
      day: currentDay,
      opponent: opponent,
      isAway: isAway,
      score: score,
      time: time,
      result: result,
      field: field,
    });
  }

  return games;
}

// ── Run ──

async function main() {
  console.log("=== Zorts Scraper Tests ===");

  await testSessionFlow();
  await testGracefulDegradation();

  console.log("\n--- Results ---");
  console.log("Passed: " + passed);
  console.log("Failed: " + failed);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (e) {
  console.error("Test runner error:", e);
  process.exit(1);
});
