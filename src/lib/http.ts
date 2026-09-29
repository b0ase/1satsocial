import { NextResponse } from "next/server";

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
