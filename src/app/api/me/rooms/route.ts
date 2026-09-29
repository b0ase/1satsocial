import { eligibleRooms } from "@/lib/rooms";
import { getSession } from "@/lib/session";
import { json } from "@/lib/http";

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "Not signed in" }, 401);
  return json({ rooms: await eligibleRooms(session) });
}
