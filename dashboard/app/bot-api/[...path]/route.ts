import { NextRequest, NextResponse } from "next/server";

// Server-side proxy: the browser talks to this route, this route talks to the bot.
// BOT_API_KEY never reaches the browser, and only the paths below can be called.
const BOT_URL = process.env.BOT_API_URL || "http://127.0.0.1:4000";
const BOT_KEY = process.env.BOT_API_KEY || "";

const GET_ALLOWED = new Set([
  "/api/health",
  "/api/status",
  "/api/positions",
  "/api/trades",
  "/api/markets",
  "/api/events",
  "/api/ai",
]);
const POST_ALLOWED = new Set([
  "/api/bot/start",
  "/api/bot/stop",
  "/api/bot/tick",
  "/api/risk/reset-halt",
  "/api/backtest",
  "/api/train",
  "/api/ai/test",
]);

async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  const route = "/" + path.join("/");

  const allowed =
    req.method === "GET"
      ? GET_ALLOWED
      : req.method === "POST"
        ? POST_ALLOWED
        : null;
  if (!allowed || !allowed.has(route)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!BOT_KEY) {
    return NextResponse.json(
      { error: "BOT_API_KEY is not set on the dashboard server" },
      { status: 500 },
    );
  }

  // CSRF guard: state-changing calls must come from this same site.
  if (req.method === "POST") {
    const origin = req.headers.get("origin");
    let sameSite = false;
    try {
      sameSite = !!origin && new URL(origin).host === req.headers.get("host");
    } catch {}
    if (!sameSite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const headers: Record<string, string> = { "X-API-Key": BOT_KEY };
  let body: string | undefined;
  if (req.method === "POST") {
    body = await req.text();
    if (body) headers["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(BOT_URL + route + req.nextUrl.search, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(["/api/backtest", "/api/train"].includes(route) ? 120_000 : route === "/api/ai/test" ? 35_000 : 15_000),
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Bot API unreachable: ${e?.message ?? e}` },
      { status: 502 },
    );
  }
}

export { forward as GET, forward as POST };
