import { redirect } from "next/navigation";

/**
 * L'écran des flux a quitté /admin : il est désormais ouvert aux PO pour leurs
 * propres équipes, pas seulement au CEO. On garde cette redirection parce que
 * l'URL a été livrée en production et peut être en favori.
 */
export default function AdminWorkflowsRedirect() {
  redirect("/workflows");
}
