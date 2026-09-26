import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { slug } = await context.params;
  if (!slug || !/^[A-Za-z0-9_-]{4,64}$/.test(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://api.arsenyx.com/builds/${encodeURIComponent(slug)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "warframe-arsenal-index/1.0",
        },
        next: { revalidate: 300 },
      },
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to reach Arsenyx API",
      },
      { status: 502 },
    );
  }
}
