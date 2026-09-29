import { requireCEO } from "@/lib/auth-guard";
import { listDepartmentHeadCoverage } from "@/lib/access/roles-server";

export async function GET() {
  const session = await requireCEO();
  const data = await listDepartmentHeadCoverage(session.user.orgId);
  return Response.json({ data });
}
