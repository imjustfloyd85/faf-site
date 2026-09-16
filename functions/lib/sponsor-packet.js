// Sponsor Packet content generator for business sponsorship applications.
// Pulls real tier/benefit/FMV data from the FAF site and legal research.

const TIERS = {
  sideline: {
    label: "Sideline",
    amount: "$250",
    benefits: [
      "Name on sponsor wall (website)",
      "Social media recognition",
      "Quarterly impact update",
    ],
    fmv: "$0",
    deductible: "Full contribution deductible",
  },
  playmaker: {
    label: "Playmaker",
    amount: "$1,000",
    benefits: [
      "Everything in Sideline",
      "Logo on program materials",
      "Invitation to FAF events",
      "Featured partner spotlight",
    ],
    fmv: "$50",
    deductible: "Deductible amount = payment minus $50",
  },
  legacy: {
    label: "Legacy",
    amount: "$5,000+",
    benefits: [
      "Everything in Playmaker",
      "Named program sponsorship",
      "Co-branded camp or event",
      "Direct impact reporting",
      "Advisory board invitation",
    ],
    fmv: "$500",
    deductible: "Deductible amount = payment minus $500",
  },
  custom: {
    label: "Custom",
    amount: "TBD",
    benefits: [
      "Custom sponsorship structure tailored to your organization",
      "Benefits determined through direct consultation with FAF leadership",
    ],
    fmv: "TBD",
    deductible: "To be determined based on agreed benefits",
  },
};

const PLACEMENTS = [
  "Team Jerseys (Legacy)",
  "Walkout Banner & Sideline Gear (Legacy)",
  "Video Content (Legacy)",
  "Championship Event Access (Playmaker, Legacy)",
  "Homepage Hero Banner (Legacy, Planned)",
  "Team Pages (Playmaker, Legacy, Planned)",
  "Newsletter Feature (Playmaker, Legacy)",
  "Social Media Spotlight (All tiers)",
  "Sitewide Footer (All tiers, Planned)",
  "Named Permanent Section (Legacy, Planned)",
];

function tierSectionsForPdf(tier) {
  const sections = [];

  sections.push({
    heading: "About Fathers and Football",
    text:
      "Fathers and Football is a 501(c)(3) tax-exempt organization (EIN 42-1980182) " +
      "dedicated to connecting fathers to their children through the game of football. " +
      "Our programs operate in McKinney, Frisco, and across the DFW metroplex, providing " +
      "youth flag football experiences that build character, connection, and legacy.\n\n" +
      "100% of sponsorship contributions go directly to programs. Every dollar funds " +
      "equipment, field time, tournament entry, and the infrastructure that puts " +
      "fathers on the field with their kids.",
  });

  sections.push({
    heading: "Sponsorship Tiers",
    text: Object.values(TIERS)
      .filter((t) => t.label !== "Custom")
      .map((t) => {
        return `${t.label} (${t.amount}):\n${t.benefits.map((b) => "  - " + b).join("\n")}`;
      })
      .join("\n\n"),
  });

  if (tier && TIERS[tier]) {
    const selected = TIERS[tier];
    sections.push({
      heading: `Your Selected Tier: ${selected.label} (${selected.amount})`,
      text: `Benefits included:\n${selected.benefits.map((b) => "  - " + b).join("\n")}`,
    });
  }

  sections.push({
    heading: "Digital Real Estate -- Where Your Brand Lives",
    text:
      "Every sponsorship tier includes placement on fathersandfootball.org and " +
      "across FAF programs. Placements last the length of your sponsorship term.\n\n" +
      PLACEMENTS.map((p) => "  - " + p).join("\n"),
  });

  sections.push({
    heading: "Tax Disclosure (IRC Section 6115)",
    text:
      "Because each sponsorship tier includes tangible benefits (such as logo " +
      "placement, event invitations, or co-branded programming), only the portion " +
      "of your contribution that exceeds the fair market value of the benefits " +
      "received may be tax-deductible.\n\n" +
      "Fair Market Value Estimates:\n" +
      "  - Sideline ($250): FMV $0 -- full contribution deductible\n" +
      "  - Playmaker ($1,000): FMV $50 -- deductible = payment minus $50\n" +
      "  - Legacy ($5,000+): FMV $500 -- deductible = payment minus $500\n\n" +
      "Please consult your tax advisor for guidance specific to your situation.",
  });

  // [PENDING FLOYD REVIEW] -- the "why FAF" value proposition below uses
  // factual program info from the site but the pitch framing may need
  // Floyd's voice/edits before going live.
  sections.push({
    heading: "Why Partner With FAF",
    text:
      "Your sponsorship puts fathers on the field with their kids. FAF programs " +
      "operate across multiple states, fielding competitive teams that have " +
      "competed at the NFL FLAG National Championship. When you sponsor FAF, " +
      "your brand is seen by families at practices, games, tournaments, and " +
      "across all FAF digital channels.\n\n" +
      "We keep our sponsor count intentionally small so each partner gets " +
      "meaningful visibility -- not a logo lost in a grid of hundreds.",
  });

  sections.push({
    heading: "Next Steps",
    text:
      "A member of the FAF team will follow up within 2 business days to " +
      "discuss your sponsorship in detail. If you have questions before then, " +
      "reach out to justin@fathersandfootball.org.",
  });

  return sections;
}

export function getSponsorPacketPdfContent(
  businessName,
  contactName,
  selectedTier,
) {
  return {
    title: "Fathers and Football -- Sponsorship Packet",
    sections: [
      {
        heading: "",
        text: `Prepared for: ${businessName}\nContact: ${contactName}\nDate: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      },
      ...tierSectionsForPdf(selectedTier),
    ],
    footer:
      "Fathers and Football | 501(c)(3) | EIN 42-1980182 | fathersandfootball.org",
  };
}

export function getSponsorPacketHtml(businessName, contactName, selectedTier) {
  const tier = TIERS[selectedTier] || TIERS.custom;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="border-bottom: 3px solid #c8923c; padding-bottom: 16px; margin-bottom: 24px;">
        <h1 style="color: #c8923c; margin: 0; font-size: 24px;">Fathers and Football</h1>
        <p style="color: #666; margin: 4px 0 0; font-size: 13px;">Sponsorship Packet</p>
      </div>

      <p>Dear ${contactName},</p>

      <p>Thank you for your interest in partnering with Fathers and Football. We received your
      sponsorship application on behalf of <strong>${businessName}</strong> and are excited to
      explore how we can work together.</p>

      <p>You expressed interest in the <strong>${tier.label} (${tier.amount})</strong> tier.
      Attached to this email is your sponsorship packet with full details on all tiers, digital
      placements, and tax disclosure information.</p>

      <h3 style="color: #c8923c; margin-top: 24px;">${tier.label} Tier Benefits</h3>
      <ul style="color: #333; line-height: 1.8;">
        ${tier.benefits.map((b) => `<li>${b}</li>`).join("")}
      </ul>

      <h3 style="color: #c8923c; margin-top: 24px;">Tax Information (IRC 6115)</h3>
      <p style="font-size: 13px; color: #555;">
        Fair Market Value of ${tier.label} tier benefits: <strong>${tier.fmv}</strong><br/>
        ${tier.deductible}
      </p>

      <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />

      <p>A member of our team will follow up within 2 business days. If you have questions
      before then, reply to this email or reach out to
      <a href="mailto:justin@fathersandfootball.org" style="color: #c8923c;">justin@fathersandfootball.org</a>.</p>

      <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 12px; color: #999;">
        <p>Fathers and Football | 501(c)(3) | EIN 42-1980182<br/>
        <a href="https://fathersandfootball.org" style="color: #c8923c;">fathersandfootball.org</a></p>
      </div>
    </div>
  `;
}
