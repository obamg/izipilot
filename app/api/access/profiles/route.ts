// app/api/access/profiles/route.ts
import { requireCEO } from "@/lib/auth-guard";
import { listConfigIssues } from "@/lib/access/profile-server";

export async function GET() {
  const session = await requireCEO();
  const issues = await listConfigIssues(session.user.orgId);
  return Response.json({ data: issues });
}
