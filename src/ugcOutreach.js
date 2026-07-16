// Lavalle Haus UGC outreach templates — the DM script + follow-up email used
// on every outreach card. Kept in one place so the copy stays consistent and a
// wording change only happens here. See the "Lavalle Haus UGC" board.

export const UGC_DM_SCRIPT =
`Hi, we came across your content and loved your aesthetic. We felt your content aligned beautifully with what we're building at Lavalle Haus.

We're reaching out regarding a paid collaboration for one short-form lifestyle video featuring our Vanilla Cashmere Body Scrub and Mini Candle. Compensation is $125 plus the gifted products.

If this feels aligned, we'd love to send over additional details and discuss further. Feel free to send over your email, or let us know if you have any questions.`;

export const UGC_EMAIL_SUBJECT = "Lavalle Haus — Collaboration Details";

export const UGC_EMAIL_BODY =
`Hi,

Thank you again for connecting with us through Lavalle Haus. We're excited to collaborate with you.

Lavalle Haus centers around elevated home and body essentials designed to bring a sense of quiet luxury to everyday routines through thoughtful materials, natural ingredients, and timeless design.

For this collaboration, we are looking for one short-form lifestyle video featuring our Vanilla Cashmere Sugar Scrub and Mini Botanical Candle in a way that feels natural to your personal aesthetic.

Details:

• Deliverable: 1 short-form video
• Usage: Brand use across Lavalle Haus channels
• Compensation: $125 issued upon final delivery
• Product: 1 Vanilla Cashmere Sugar Scrub + 1 Mini Botanical Candle

If this feels aligned, feel free to send over:

• Your full name
• Your preferred shipping address

Our full creative brief is attached. Everything in it is a suggestion, not a script — we genuinely encourage you to follow your natural content and whatever fits your lifestyle, since that authenticity is exactly what we're drawn to.

Looking forward to working together.

Best,
Kiabeth
Lavalle Haus`;

// Reference-videos block, appended to the email when the card has example links.
export const UGC_REF_INTRO =
"A few of your own videos we especially loved — this is exactly the feel we envision, whether it's naturally mixing in our products or simply the overall mood:";
export const UGC_REF_OUTRO =
"These are shared purely as inspiration — please stay true to your own style and lifestyle.";

// Compose the final email body, appending the reference-videos block if any of
// the (up to 3) example links are filled in.
export function composeOutreachEmail(body, refs) {
  const links = (refs || []).map((s) => (s || "").trim()).filter(Boolean);
  if (!links.length) return body;
  const block = "\n\n" + UGC_REF_INTRO + "\n\n" + links.map((u) => "• " + u).join("\n") + "\n\n" + UGC_REF_OUTRO;
  // Insert the block just before the sign-off ("Looking forward…") when present.
  const marker = "Looking forward to working together.";
  const i = body.indexOf(marker);
  if (i === -1) return body + block;
  return body.slice(0, i).replace(/\s+$/, "") + block + "\n\n" + body.slice(i);
}

// Public URL of the combined brand-brief PDF (served from /public). Attached to
// the outreach email and downloadable from each card.
export const UGC_BRIEF_PDF = "/lavalle-haus-ugc-brief.pdf";
export const UGC_EMAIL_FROM = "info@lavallehaus.com";
