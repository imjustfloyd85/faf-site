# FAF Sponsorship FMV Research (IRC 6115)

**As-of date:** 2026-08-16
**Status:** Good-faith research estimates. Floyd to confirm/adjust with FAF's CPA before treating as final.
**Verify-live:** IRS inflation-adjusted safe harbor thresholds update annually (Rev. Proc. 2025-32 for 2026) — check irs.gov/charities-non-profits for updates before relying on this for a future tax year.

## Governing law

IRC 6115 requires a written disclosure on any quid pro quo contribution over $75, stating (a) that only the portion exceeding the fair market value (FMV) of benefits received is deductible, and (b) a good-faith FMV estimate. Penalty for failure: $10/contribution, capped at $5,000 per event/mailing (IRC 6714). Treas. Reg. 1.6115-1 permits "any reasonable methodology" applied in good faith.

## The key distinction: acknowledgment vs. advertising

Under Treas. Reg. 1.513-4(c)(2)(iv), sponsor name/logo, value-neutral descriptions, and exclusive "presented by" designations are **acknowledgment** — FMV $0, not a taxable benefit — as long as there's no qualitative/comparative language ("best," "most affordable") or call-to-action. Cross that line and it becomes advertising with real FMV, which also has IRC 513(i) UBIT implications for the org separately from the donor-deduction question.

Confirmed against the actual site implementation (`functions/api/approved-sponsors.js`, sponsor wall render logic in `sponsors.html`): every approved sponsor, regardless of tier, is rendered identically — logo, name, tier label, nothing else. No bio/endorsement text field exists. So the "Featured partner spotlight" Playmaker benefit is, as currently built, pure acknowledgment with no advertising-language risk.

## 2026 insubstantial-benefit safe harbor (Rev. Proc. 90-12/92-49, updated by Rev. Proc. 2025-32)

- 2%/$139 test: benefits are insubstantial if aggregate FMV doesn't exceed the lesser of 2% of the payment or $139
- Low-cost article: $13.90
- Token benefit minimum payment: $69.50

## Tier-by-tier

**Sideline ($250)** — name on sponsor wall, social media mention, quarterly update. Pure acknowledgment, clears the 2%/$139 safe harbor. **FMV: $0. Full contribution deductible.**

**Playmaker ($1,000)**

| Benefit                   | FMV    | Reasoning                                                                         |
| ------------------------- | ------ | --------------------------------------------------------------------------------- |
| Logo on program materials | $0     | Acknowledgment, confirmed no qualitative language                                 |
| Featured spotlight        | $0     | Confirmed identical to base sponsor-wall entry — no differentiated content exists |
| Event invitation          | $25–50 | Comparable to a youth-sports-banquet-scale ticket                                 |

**FMV disclosed: $50** (conservative/higher end — understating FMV overstates the sponsor's deductible amount). **Deductible: payment − $50.**

**Legacy ($5,000 minimum, variable)** — fixed floor, does not scale with payment size above the minimum:

| Benefit                   | FMV      | Reasoning                                                                               |
| ------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Named program sponsorship | $100–200 | **Judgment call** — no direct IRS guidance; comparable to community-scale naming rights |
| Co-branded camp/event     | $150–300 | **Judgment call** — comparable to local advertising/branding rate                       |
| Direct impact reporting   | $0       | Factual data delivery, not a commercial benefit                                         |
| Advisory board seat       | $0       | Unpaid, no fiduciary/voting authority                                                   |

**FMV disclosed: $500** (conservative/higher end). **Deductible: payment − $500**, regardless of how far above $5,000 the sponsor gives.

## Judgment calls needing CPA sign-off

Named program sponsorship and co-branded event valuations have no direct IRS comparable. Suggested anchor if the CPA wants a defensible reference point: local advertising rate cards (newspaper, youth sports program ad pages).

## Should FAF build a dedicated tax/compliance agent?

No, not at this scale. FAF's compliance surface (one 990/year, quid pro quo disclosure on three tiers, donation receipts) doesn't justify dedicated persistent infrastructure — ad hoc research/SME dispatch handles it fine. Revisit if FAF adds multiple programs, multiple event types with different benefit structures, or grant compliance requirements.

## Implementation

Figures are implemented as `TIER_FMV_CENTS` in `functions/api/stripe-webhook.js`, feeding both the donor-facing disclosure text and the org notification email (so there's an internal record of what was disclosed on each sponsorship). Covered by tests T3.8–T3.10a in `tests/stripe-checkout.test.js`.
