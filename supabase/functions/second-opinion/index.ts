// Supabase Edge Function: sends a plan to Claude and returns its review.
// Deploy: supabase functions deploy second-opinion
// Secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (optional: ANTHROPIC_MODEL)
// Supabase verifies the caller's login (JWT) before this code runs, so only signed-in users can call it.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY is not set for this function." }, 500);
    const { prompt } = await req.json();
    if (typeof prompt !== "string" || !prompt || prompt.length > 60000) return json({ error: "Send a prompt under 60,000 characters." }, 400);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
        max_tokens: 900,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const body = await r.json();
    if (!r.ok) return json({ error: body?.error?.message ?? `Claude returned ${r.status}` }, 502);
    const text = (body.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n");
    return json({ text });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });
}
