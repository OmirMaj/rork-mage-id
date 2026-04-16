import { Hono } from "hono";

const emailRoute = new Hono();

interface SendEmailBody {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  from?: string;
}

emailRoute.post("/send", async (c) => {
  try {
    const body = await c.req.json<SendEmailBody>();

    if (!body.to || !body.subject || !body.html) {
      return c.json({ success: false, error: "Missing required fields: to, subject, html" }, 400);
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error("[Email] RESEND_API_KEY is not configured");
      return c.json({ success: false, error: "Email service not configured" }, 500);
    }

    const fromAddress = body.from || process.env.RESEND_FROM_EMAIL || "MAGE ID <onboarding@resend.dev>";

    console.log(`[Email] Sending email to ${body.to} with subject: ${body.subject}`);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [body.to],
        subject: body.subject,
        html: body.html,
        reply_to: body.replyTo || undefined,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[Email] Resend API error:", result);
      return c.json({ success: false, error: result?.message || "Failed to send email" }, 502);
    }

    console.log("[Email] Email sent successfully:", result);
    return c.json({ success: true, id: result.id });
  } catch (err) {
    console.error("[Email] Error sending email:", err);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

export default emailRoute;
