// Sponsorship Logo Placement Agreement — Fathers and Football
// Drafted via Accord contract-analyst patterns.
//
// Contains:
//   1. Rep/warranty on logo ownership (copyright + trademark)
//   2. Indemnification clause protecting FAF
//   3. IRC 6115 quid-pro-quo disclosure (mirrors sponsors.html language)
//   4. Self-attestation acceptance (no independent IP search per Floyd directive)
//
// Version-controlled so we can track which agreement version a sponsor accepted.

export const AGREEMENT_VERSION = "1.0";

// Returns the full agreement HTML for display in the checkout modal.
// sponsorOrg and tierLabel are escaped by the caller before passing here.
export function getAgreementHtml(sponsorOrg, tierLabel) {
  return `
<h3 style="margin-bottom:12px;">Fathers and Football — Sponsorship Logo Placement Agreement</h3>
<p style="font-size:13px;color:#999;margin-bottom:16px;">Agreement Version ${AGREEMENT_VERSION}</p>

<p>This Sponsorship Logo Placement Agreement ("Agreement") is entered into
between <strong>${sponsorOrg || "the Sponsor"}</strong> ("Sponsor") and
<strong>Fathers and Football</strong>, a 501(c)(3) tax-exempt organization
(EIN 42-1980182) ("FAF"), effective as of the date of Sponsor's electronic
acceptance below.</p>

<h4>1. Grant of License</h4>
<p>Sponsor grants FAF a non-exclusive, royalty-free, revocable license to
reproduce, display, and distribute Sponsor's logo, trademark, and trade name
(collectively, "Logo") on the FAF website, program materials, and event
signage in connection with Sponsor's <strong>${tierLabel}</strong> sponsorship.
FAF reserves the right to resize, reformat, or adjust the Logo for layout
purposes without altering its substantive content.</p>

<h4>2. Representations and Warranties</h4>
<p>Sponsor represents and warrants that:</p>
<ul>
  <li>Sponsor is the sole owner of, or has obtained all necessary rights,
  licenses, and permissions to use and authorize use of, the Logo;</li>
  <li>The Logo does not infringe any copyright, trademark, trade dress, patent,
  trade secret, right of publicity, or other intellectual property or
  proprietary right of any third party;</li>
  <li>Sponsor has full authority to enter into this Agreement and grant the
  license described herein; and</li>
  <li>The Logo does not contain any content that is defamatory, obscene,
  unlawful, or otherwise objectionable.</li>
</ul>

<h4>3. Indemnification</h4>
<p>Sponsor shall indemnify, defend, and hold harmless FAF, its officers,
directors, employees, volunteers, and agents from and against any and all
claims, damages, losses, liabilities, costs, and expenses (including
reasonable attorneys' fees) arising out of or related to: (a) any breach of
the representations and warranties set forth in Section 2; (b) any allegation
that the Logo infringes the intellectual property rights of a third party; or
(c) any use of the Logo by FAF in accordance with this Agreement.</p>

<h4>4. Tax Disclosure (IRC Section 6115)</h4>
<p>Because each sponsorship tier includes tangible benefits (such as logo
placement, event invitations, or co-branded programming), only the portion
of Sponsor's contribution that exceeds the fair market value of the benefits
received may be tax-deductible. In accordance with IRC Section 6115, FAF
will provide Sponsor a written acknowledgment that includes a good-faith
estimate of the fair market value of the benefits associated with the
selected tier. Sponsor should consult a tax advisor for guidance specific
to Sponsor's situation.</p>

<h4>5. Approval and Placement</h4>
<p>All logo placements are subject to FAF's review and approval. FAF reserves
the sole right to approve, reject, or request modifications to any Logo
submission. Sponsor's Logo will not appear on the FAF website or materials
until FAF has reviewed and approved the submission. FAF may reject any Logo
at its discretion without obligation to state a reason.</p>

<h4>6. Termination</h4>
<p>Either party may terminate this Agreement upon thirty (30) days' written
notice to the other party. Upon termination, FAF will remove Sponsor's Logo
from all FAF-controlled media within a reasonable period.</p>

<h4>7. Governing Law</h4>
<p>This Agreement shall be governed by the laws of the State of Texas.</p>
`;
}

// Returns a plain-text summary of the agreement for email confirmations.
export function getAgreementSummary() {
  return (
    "By accepting, the sponsor represented and warranted that they own all " +
    "rights to the submitted logo (copyright, trademark) and agreed to " +
    "indemnify FAF against any third-party IP claims. Logo placement is " +
    "subject to FAF review and approval. Full agreement version " +
    AGREEMENT_VERSION +
    "."
  );
}
