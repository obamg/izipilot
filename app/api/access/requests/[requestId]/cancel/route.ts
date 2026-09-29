import { auth } from "@/lib/auth";
import { cancelRequest, RequestError } from "@/lib/access/requests-server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { requestId } = await params;

  try {
    await cancelRequest(session.user.orgId, session.user.id, requestId);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof RequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
