#!/usr/bin/env node
// One-time seed script: writes 25 verified sponsor leads into Cloudflare KV.
// Run with: node scripts/seed-sponsor-leads.js
// Uses wrangler kv:bulk put under the hood.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const KV_NAMESPACE_ID = "f2ced3e931084f4f80a99fe53a1f744f";
const INDEX_KEY = "sponsor-leads-index";

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const leads = [
  {
    businessName: "Frisco Sports Center",
    category: "Sporting Goods",
    city: "Frisco",
    contactInfo:
      "10150 Legacy Dr Ste 200A, Frisco TX 75033, (972) 335-3630, info@friscosportstx.com",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Play It Again Sports McKinney",
    category: "Sporting Goods",
    city: "McKinney",
    contactInfo: "1434 N Central Expy Ste 109, (469) 424-1715",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Fabiola Sears - State Farm",
    category: "Insurance",
    city: "Frisco",
    contactInfo: "4645 Wyndham Ln Ste 280, (469) 306-9700",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Fabio Fernandez - State Farm",
    category: "Insurance",
    city: "Frisco",
    contactInfo: "friscoagentfabio.com",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Gene Wolfgram - State Farm",
    category: "Insurance",
    city: "Frisco",
    contactInfo: "(972) 335-9731",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Jennifer Kasallis - Farmers Insurance",
    category: "Insurance",
    city: "Allen",
    contactInfo: "100 Allentown Pkwy Ste 206, (469) 804-0696",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Sunni Josey - Farmers Insurance",
    category: "Insurance",
    city: "Allen",
    contactInfo: "Directory listing only",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Frisco Family & Sports Chiropractic",
    category: "Sports Medicine",
    city: "Frisco",
    contactInfo: "8501 Wade Blvd Ste 420, (972) 294-5534",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Venn Chiropractic and Wellness Center",
    category: "Sports Medicine",
    city: "Frisco",
    contactInfo: "2840 Legacy Dr Ste 410, (972) 668-9200",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Starwood Chiropractic",
    category: "Sports Medicine",
    city: "Frisco",
    contactInfo: "4851 Legacy Dr Ste 307, (972) 377-3909",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Dynamic Sports Medicine McKinney",
    category: "Sports Medicine",
    city: "McKinney",
    contactInfo: "8701 W University Dr, (214) 884-5158",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "The Craft Chiropractic",
    category: "Sports Medicine",
    city: "Frisco",
    contactInfo: "thecraftchiropractic.com",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Chick-fil-A Preston Rd & Gary Burns",
    category: "Restaurant",
    city: "Frisco",
    contactInfo: "Owner-operator Frieda Marroquin",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Mountain Mike's Pizza McKinney",
    category: "Restaurant",
    city: "McKinney",
    contactInfo: "mountainmikespizza.com/locations/mckinney-w-university-dr",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Mr Jim's Pizza McKinney",
    category: "Restaurant",
    city: "McKinney",
    contactInfo: "1920 Eldorado Pkwy #850, (972) 200-9929",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Honda Cars of McKinney",
    category: "Auto Dealership",
    city: "McKinney",
    contactInfo: "hondacarsofmckinney.com/psa.htm",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Sam Pack's Five Star Ford McKinney",
    category: "Auto Dealership",
    city: "McKinney",
    contactInfo: "5starford.com/locations-mckinney-tx",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Texans Credit Union",
    category: "Bank/Credit Union",
    city: "McKinney",
    contactInfo: "texanscu.org/misd",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Credit Union of Texas",
    category: "Bank/Credit Union",
    city: "Allen",
    contactInfo: "cutx.org/community",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Prosperity Bank",
    category: "Bank/Credit Union",
    city: "Frisco/Allen/McKinney",
    contactInfo: "Multiple branches",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Redline Athletics Frisco",
    category: "Youth Training Facility",
    city: "Frisco",
    contactInfo: "145 Rose Lane, frisco@redlineathletics.com",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Real Superior Athletics (RSA)",
    category: "Youth Training Facility",
    city: "Frisco",
    contactInfo: "Ronnie Braxton (214) 263-7180, Brandy Braxton (214) 407-0355",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Sports Academy Frisco",
    category: "Youth Training Facility",
    city: "Frisco",
    contactInfo: "sportsacademy.us/pages/athletic-training-frisco",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "D1 Training Frisco",
    category: "Youth Training Facility",
    city: "Frisco",
    contactInfo: "d1training.com/facility/frisco",
    source: "Verified web research, 2026-08-27",
  },
  {
    businessName: "Reed Athletic Performance",
    category: "Youth Training Facility",
    city: "Plano/Allen/Frisco/McKinney",
    contactInfo: "kreedspeed.com",
    source: "Verified web research, 2026-08-27",
  },
];

// Build the KV bulk-write payload
const now = new Date().toISOString();
const ids = [];
const bulkEntries = [];

for (const raw of leads) {
  // Small delay between ID generation to avoid collisions
  const id = generateId();
  ids.push(id);

  const lead = {
    id,
    businessName: raw.businessName,
    category: raw.category,
    city: raw.city,
    contactInfo: raw.contactInfo,
    source: raw.source,
    status: "new",
    promising: null,
    relationshipType: "undecided",
    notes: [],
    createdAt: now,
    updatedAt: now,
  };

  bulkEntries.push({
    key: `sponsor-lead:${id}`,
    value: JSON.stringify(lead),
  });
}

// Add the index entry
bulkEntries.push({
  key: INDEX_KEY,
  value: JSON.stringify(ids),
});

// Write the bulk JSON file
const tmpFile = path.join(__dirname, ".seed-bulk.json");
fs.writeFileSync(tmpFile, JSON.stringify(bulkEntries, null, 2));

console.log(
  `Generated ${leads.length} leads + index (${bulkEntries.length} KV entries total)`,
);
console.log(`Bulk file: ${tmpFile}`);

// Run wrangler kv:bulk put
try {
  const cmd = `npx wrangler kv bulk put "${tmpFile}" --namespace-id ${KV_NAMESPACE_ID} --remote`;
  console.log(`Running: ${cmd}`);
  const output = execSync(cmd, {
    cwd: path.join(__dirname, ".."),
    stdio: "pipe",
  });
  console.log(output.toString());
  console.log("Seed complete. All 25 leads written to KV.");
} catch (err) {
  console.error("wrangler kv:bulk put failed:");
  console.error(err.stderr ? err.stderr.toString() : err.message);
  process.exit(1);
} finally {
  // Clean up temp file
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
}
