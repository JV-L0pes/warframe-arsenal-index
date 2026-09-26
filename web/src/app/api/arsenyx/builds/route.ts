import { NextResponse } from "next/server";

const UPSTREAM = "https://api.arsenyx.com/builds";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const upstream = new URL(UPSTREAM);
  incoming.searchParams.forEach((value, key) => {
    upstream.searchParams.set(key, value);
  });

  try {
    const res = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "warframe-arsenal-index/1.0",
      },
      next: { revalidate: 60 },
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
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
