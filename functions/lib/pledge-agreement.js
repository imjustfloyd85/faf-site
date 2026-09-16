export const PLEDGE_AGREEMENT_VERSION = "1.0";

export function getPledgeAgreementHtml(donorName, amount, date) {
  return `
<h3 style="margin-bottom:12px;">Fathers and Football -- Pledge Agreement</h3>
<p style="font-size:13px;color:#999;margin-bottom:16px;">Agreement Version ${PLEDGE_AGREEMENT_VERSION}</p>

<p>This Pledge Agreement ("Agreement") is entered into by
<strong>${donorName || "the Donor"}</strong> ("Donor") in favor of
<strong>Fathers and Football</strong>, a 501(c)(3) tax-exempt organization
(EIN 42-1980182) ("FAF"), effective as of ${date}.</p>

<h4>1. Pledge</h4>
<p>Donor hereby pledges to contribute <strong>$${amount}</strong> to FAF
in accordance with the terms set forth herein.</p>

<h4>2. Terms and Conditions</h4>
<p style="background:rgba(200,146,60,0.1);padding:12px;border-left:3px solid #c8923c;">
[PENDING FLOYD REVIEW] -- The specific pledge terms, conditions, enforceability
language, payment timeline, and cancellation policy will be inserted here after
legal review. This section will govern the binding nature of the pledge, any
conditions precedent, and the donor's rights and obligations.</p>

<h4>3. Purpose</h4>
<p style="background:rgba(200,146,60,0.1);padding:12px;border-left:3px solid #c8923c;">
[PENDING FLOYD REVIEW] -- Language specifying how pledged funds will be used
(unrestricted, program-specific, etc.) and any donor-directed restrictions.</p>

<h4>4. Tax Disclosure</h4>
<p><strong>Organization:</strong> Fathers and Football<br/>
<strong>EIN:</strong> 42-1980182<br/>
<strong>Status:</strong> 501(c)(3) tax-exempt organization</p>
<p><strong>No goods or services were provided in exchange for this contribution.</strong>
The full amount of your donation is tax-deductible to the extent allowed by law.
Please retain this acknowledgment for your tax records. Consult your tax advisor
for guidance specific to your situation.</p>

<h4>5. Acknowledgment</h4>
<p>By submitting this pledge, the Donor acknowledges that they have read and
agree to the terms of this Agreement.</p>

<h4>6. Governing Law</h4>
<p>This Agreement shall be governed by the laws of the State of Texas.</p>
`;
}

export function getPledgeAgreementPdfContent(donorName, amount, date, email) {
  return {
    title: "Fathers and Football -- Pledge Agreement",
    sections: [
      {
        heading: null,
        text: `Agreement Version ${PLEDGE_AGREEMENT_VERSION}\nDate: ${date}`,
      },
      {
        heading: "Parties",
        text:
          `Donor: ${donorName}\nEmail: ${email}\n\n` +
          "Organization: Fathers and Football\n" +
          "EIN: 42-1980182\n" +
          "Status: 501(c)(3) tax-exempt organization",
      },
      {
        heading: "1. Pledge",
        text: `Donor hereby pledges to contribute $${amount} to Fathers and Football in accordance with the terms set forth herein.`,
      },
      {
        heading: "2. Terms and Conditions",
        text: "[PENDING FLOYD REVIEW] -- The specific pledge terms, conditions, enforceability language, payment timeline, and cancellation policy will be inserted here after legal review.",
      },
      {
        heading: "3. Purpose",
        text: "[PENDING FLOYD REVIEW] -- Language specifying how pledged funds will be used (unrestricted, program-specific, etc.) and any donor-directed restrictions.",
      },
      {
        heading: "4. Tax Disclosure",
        text:
          "No goods or services were provided in exchange for this contribution. " +
          "The full amount of your donation is tax-deductible to the extent allowed by law. " +
          "Please retain this acknowledgment for your tax records. Consult your tax advisor " +
          "for guidance specific to your situation.",
      },
      {
        heading: "5. Acknowledgment",
        text: "By submitting this pledge, the Donor acknowledges that they have read and agree to the terms of this Agreement.",
      },
      {
        heading: "6. Governing Law",
        text: "This Agreement shall be governed by the laws of the State of Texas.",
      },
    ],
    footer: "Fathers and Football | fathersandfootball.org | EIN 42-1980182",
  };
}
