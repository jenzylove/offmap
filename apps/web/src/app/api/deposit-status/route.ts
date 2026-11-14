// Deposit status from 1Click. Quotes are made with Offmap's 1Click key, and 1Click only
// reports on them when asked with that key, so the browser asks through here.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!/^[A-Za-z0-9._:-]{10,128}$/.test(address)) return Response.json({ error: "bad address" }, { status: 400 });
  const key = process.env.ONECLICK_JWT;
  const r = await fetch(`https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(address)}`, {
    headers: key ? { "X-API-Key": key } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) return Response.json({ error: "1Click did not answer" }, { status: 502 });
  const body = await r.text();
  return new Response(body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
