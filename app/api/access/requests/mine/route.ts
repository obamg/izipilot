import { auth } from "@/lib/auth";
import { listMyRequests } from "@/lib/access/requests-read-server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const data = await listMyRequests(session.user.orgId, session.user.id);
  return Response.json({ data });
}
