// Newsletter change detection.
//
// Checks for new content on the FAF site by comparing the current
// git HEAD against the last-processed commit SHA stored in KV.
// Focuses on event/announcement pages (events.html, skills-clinic.html,
// community.html, blog.html, etc.) and summarizes what changed.
//
// This runs inside Cloudflare Pages Functions, which do NOT have git
// access. Instead, the cron worker calls this endpoint and passes
// the git diff summary it computed locally (the worker has access to
// the GitHub API or can shell out to git).
//
// Two modes:
//   1. "cron-provided" -- the cron worker passes { commits, diffs } directly
//   2. "kv-based" -- fall back to checking if a change summary was stored
//      in KV by a prior process
//
// KV keys:
//   newsletter:last-processed-sha   -- last commit SHA we sent a newsletter about
//   newsletter:pending-changes      -- optional: pre-computed change summary

const EVENT_PAGES = [
  "events.html",
  "skills-clinic.html",
  "community.html",
  "blog.html",
  "nationals-recap.html",
  "frisco-elite.html",
  "legacy7.html",
  "coach-letter-season-opener.html",
  "als-ice-bucket-challenge.html",
];

// Filter commits to only those touching event/announcement pages
export function filterRelevantCommits(commits) {
  if (!Array.isArray(commits)) return [];

  return commits.filter((c) => {
    const files = c.files || [];
    return files.some((f) =>
      EVENT_PAGES.some((page) => f.endsWith(page) || f.includes(`/${page}`)),
    );
  });
}

// Build a plain-text summary of changes from commit data.
// Each commit object: { sha, message, files, diffs }
// diffs is optional -- array of { file, patch } objects.
export function summarizeChanges(commits) {
  if (!commits || commits.length === 0) return null;

  const lines = [];

  for (const commit of commits) {
    const relevantFiles = (commit.files || []).filter((f) =>
      EVENT_PAGES.some((page) => f.endsWith(page) || f.includes(`/${page}`)),
    );

    if (relevantFiles.length === 0) continue;

    lines.push(`Commit: ${commit.message}`);
    lines.push(`Files changed: ${relevantFiles.join(", ")}`);

    // Include diff snippets if available
    if (commit.diffs && Array.isArray(commit.diffs)) {
      for (const d of commit.diffs) {
        if (!EVENT_PAGES.some((page) => d.file?.endsWith(page))) continue;
        // Only include added lines (starting with +) to show what's new
        // Skip diff headers (lines starting with ++)
        const addedLines = (d.patch || "")
          .split("\n")
          .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
          .map((line) => line.slice(1).trim())
          // Strip HTML tags for readability
          .map((line) => line.replace(/<[^>]+>/g, " ").trim())
          .filter((line) => line.length > 5);

        if (addedLines.length > 0) {
          lines.push(`New content in ${d.file}:`);
          // Cap at 30 lines per file to keep the prompt manageable
          lines.push(addedLines.slice(0, 30).join("\n"));
        }
      }
    }

    lines.push(""); // blank separator between commits
  }

  const summary = lines.join("\n").trim();
  return summary || null;
}

// Check whether a monthly digest is due.
// Returns true if no monthly send has happened in the current calendar month.
export async function isMonthlyDigestDue(kv) {
  const lastMonthly = await kv.get("newsletter:last-monthly-send");
  if (!lastMonthly) return true;

  const lastDate = new Date(lastMonthly);
  const now = new Date();

  // Due if we haven't sent one this calendar month
  return (
    lastDate.getFullYear() !== now.getFullYear() ||
    lastDate.getMonth() !== now.getMonth()
  );
}

// Mark the monthly digest as sent for the current month.
export async function markMonthlySent(kv) {
  await kv.put("newsletter:last-monthly-send", new Date().toISOString());
}

// Get the last-processed SHA from KV.
export async function getLastProcessedSha(kv) {
  return await kv.get("newsletter:last-processed-sha");
}

// Update the last-processed SHA in KV.
export async function setLastProcessedSha(kv, sha) {
  await kv.put("newsletter:last-processed-sha", sha);
}

export { EVENT_PAGES };
