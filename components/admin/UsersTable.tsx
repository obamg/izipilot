"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserFormModal } from "./UserFormModal";
import { ResetPasswordModal } from "./ResetPasswordModal";
import { ConfirmDialog } from "./ConfirmDialog";

interface UserData {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UsersTableProps {
  users: UserData[];
  currentUserId: string;
}

// Ordre hiérarchique : sert au tri par rôle et à l'ordre des filtres.
const ROLES = ["CEO", "MANAGEMENT", "PO", "CONTRIBUTOR", "VIEWER"] as const;

// La couleur du rôle est portée par la pastille et l'avatar ; le libellé reste
// en texte sombre pour garder un contraste AA sur tous les fonds clairs.
const ROLE_STYLE: Record<string, { label: string; dot: string; tint: string }> = {
  CEO: { label: "CEO", dot: "bg-teal", tint: "bg-teal-lt" },
  MANAGEMENT: { label: "Management", dot: "bg-gold", tint: "bg-gold-lt" },
  PO: { label: "PO", dot: "bg-izi-green", tint: "bg-izi-green-lt" },
  CONTRIBUTOR: { label: "Contributeur", dot: "bg-blue", tint: "bg-blue-lt" },
  VIEWER: { label: "Observateur", dot: "bg-izi-gray", tint: "bg-izi-gray-lt" },
};
const roleStyle = (r: string) => ROLE_STYLE[r] ?? ROLE_STYLE.VIEWER;

type SortKey = "name" | "role" | "lastLogin";
type Sort = { key: SortKey; dir: "asc" | "desc" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Accents ignorés : « helene » trouve « Hélène ».
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
function lastLoginLabel(iso: string | null): string {
  if (!iso) return "Jamais connecté";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 7) return capitalize(rtf.format(-days, "day"));
  if (days < 30) return capitalize(rtf.format(-Math.floor(days / 7), "week"));
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
const fullDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }) : undefined;

export function UsersTable({ users, currentUserId }: UsersTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const [error, setError] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<UserData | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser, setResetUser] = useState<UserData | null>(null);
  const [deactivateUser, setDeactivateUser] = useState<UserData | null>(null);
  const [reactivateUser, setReactivateUser] = useState<UserData | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // « / » place le curseur dans la recherche, comme sur la plupart des outils.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inactiveCount = users.filter((u) => !u.isActive).length;
  const pool = useMemo(() => (showInactive ? users : users.filter((u) => u.isActive)), [users, showInactive]);

  const roleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const u of pool) c[u.role] = (c[u.role] ?? 0) + 1;
    return c;
  }, [pool]);

  const rows = useMemo(() => {
    const q = fold(search.trim());
    const list = pool.filter(
      (u) =>
        (roleFilter === "ALL" || u.role === roleFilter) &&
        (!q || fold(u.name).includes(q) || fold(u.email).includes(q))
    );
    const sign = sort.dir === "asc" ? 1 : -1;
    const rank = (r: string) => ROLES.indexOf(r as (typeof ROLES)[number]);
    const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);
    return list.sort((a, b) => {
      // Comptes désactivés toujours en bas, quel que soit le tri.
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const byName = a.name.localeCompare(b.name, "fr");
      const d =
        sort.key === "role" ? rank(a.role) - rank(b.role)
        : sort.key === "lastLogin" ? time(a.lastLoginAt) - time(b.lastLoginAt)
        : byName;
      return sign * d || byName;
    });
  }, [pool, search, roleFilter, sort]);

  const filtersActive = search !== "" || roleFilter !== "ALL";
  function clearFilters() {
    setSearch("");
    setRoleFilter("ALL");
    searchRef.current?.focus();
  }

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "lastLogin" ? "desc" : "asc" }
    );
  }

  async function setActive(user: UserData | null, isActive: boolean) {
    if (!user) return;
    setError(null);
    const res = await fetch(
      `/api/admin/users/${user.id}`,
      isActive
        ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: true }) }
        : { method: "DELETE" }
    ).catch(() => null);
    setDeactivateUser(null);
    setReactivateUser(null);
    if (!res?.ok) {
      setError(`Le compte de ${user.name} n'a pas pu être ${isActive ? "réactivé" : "désactivé"}. Réessayez.`);
      return;
    }
    startTransition(() => router.refresh());
  }

  const actionHandlers = {
    onEdit: setEditUser,
    onReset: setResetUser,
    onDeactivate: setDeactivateUser,
    onReactivate: setReactivateUser,
  };

  return (
    <div>
      {/* Recherche + création */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-[420px]">
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-izi-gray"
          >
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearch("")}
            placeholder="Rechercher par nom ou email"
            aria-label="Rechercher un utilisateur par nom ou email"
            className="izi-form-input md:!text-[13px] h-10 w-full rounded-[10px] border border-border-soft bg-white pl-9 pr-10 text-dark placeholder:text-izi-gray/80 transition-colors hover:border-teal-md focus:border-teal focus:outline-none focus:ring-[3px] focus:ring-teal/15 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {search ? (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
              aria-label="Effacer la recherche"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-izi-gray hover:bg-izi-gray-lt hover:text-dark focus-visible:outline-2 focus-visible:outline-teal"
            >
              <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3">
                <path d="m2 2 8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <kbd
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border-soft bg-izi-gray-lt px-1.5 font-sans text-[11px] text-izi-gray md:block"
            >
              /
            </kbd>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-teal px-4 text-[13px] font-medium text-white transition-colors hover:bg-teal-dk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal sm:ml-auto"
        >
          <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3">
            <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Ajouter un utilisateur
        </button>
      </div>

      {/* Filtres par rôle */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Filtrer par rôle" className="flex flex-wrap gap-1.5">
          {(["ALL", ...ROLES] as const).map((r) => {
            const count = r === "ALL" ? pool.length : roleCounts[r] ?? 0;
            if (r !== "ALL" && count === 0) return null;
            const on = roleFilter === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                onClick={() => setRoleFilter(r)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal ${
                  on ? "border-dark bg-dark text-white" : "border-border-soft bg-white text-dark-md hover:border-teal-md"
                }`}
              >
                {r !== "ALL" && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${roleStyle(r).dot}`} />}
                {r === "ALL" ? "Tous" : roleStyle(r).label}
                <span className={`tabular-nums ${on ? "text-white/70" : "text-izi-gray"}`}>{count}</span>
              </button>
            );
          })}
        </div>
        {inactiveCount > 0 && (
          <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-izi-gray sm:ml-auto">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 accent-teal"
            />
            Afficher les comptes désactivés ({inactiveCount})
          </label>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {rows.length} utilisateur{rows.length > 1 ? "s" : ""} affiché{rows.length > 1 ? "s" : ""}
      </p>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start justify-between gap-3 rounded-[10px] border border-izi-red/30 bg-izi-red-lt px-3 py-2 text-[13px] text-dark"
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-[12px] font-medium text-izi-gray hover:text-dark"
          >
            Fermer
          </button>
        </div>
      )}

      <div className="izi-table-wrap mt-4">
        {/* Bureau */}
        <table className="izi-table hidden md:table">
          <thead>
            <tr>
              <SortHeader k="name" sort={sort} onToggle={toggleSort}>Personne</SortHeader>
              <SortHeader k="role" sort={sort} onToggle={toggleSort}>Rôle</SortHeader>
              <SortHeader k="lastLogin" sort={sort} onToggle={toggleSort}>Dernière connexion</SortHeader>
              <th className="is-num">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} data-muted={u.isActive ? undefined : ""}>
                <td>
                  <Person user={u} isMe={u.id === currentUserId} />
                </td>
                <td>
                  <RoleBadge role={u.role} />
                </td>
                <td title={fullDate(u.lastLoginAt)} className={u.lastLoginAt ? "" : "text-izi-gray"}>
                  {lastLoginLabel(u.lastLoginAt)}
                </td>
                <td className="is-num whitespace-nowrap">
                  <RowActions user={u} isMe={u.id === currentUserId} {...actionHandlers} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile */}
        <ul className="divide-y divide-border-soft md:hidden">
          {rows.map((u) => (
            <li key={u.id} className={`p-4 ${u.isActive ? "" : "bg-izi-gray-lt/40"}`}>
              <div className="flex items-start justify-between gap-3">
                <Person user={u} isMe={u.id === currentUserId} />
                <RoleBadge role={u.role} />
              </div>
              <p className="mt-2 pl-11 text-[12px] text-izi-gray" title={fullDate(u.lastLoginAt)}>
                {u.lastLoginAt
                  ? `Dernière connexion : ${lastLoginLabel(u.lastLoginAt).toLowerCase()}`
                  : "Jamais connecté"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 pl-11">
                <RowActions user={u} isMe={u.id === currentUserId} {...actionHandlers} touch />
              </div>
            </li>
          ))}
        </ul>

        {rows.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="text-[14px] font-medium text-dark">
              {search ? `Aucun compte ne correspond à « ${search} ».` : "Aucun compte avec ce rôle."}
            </p>
            <p className="mt-1 text-[13px] text-izi-gray">Vérifiez l&apos;orthographe ou élargissez les filtres.</p>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 rounded-[10px] border border-border-soft bg-white px-4 py-2 text-[13px] font-medium text-teal hover:border-teal-md hover:bg-teal-lt focus-visible:outline-2 focus-visible:outline-teal"
              >
                Effacer les filtres
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modales */}
      <UserFormModal
        open={showCreate || !!editUser}
        onClose={() => {
          setShowCreate(false);
          setEditUser(null);
        }}
        user={editUser}
      />

      {resetUser && (
        <ResetPasswordModal
          open={!!resetUser}
          onClose={() => setResetUser(null)}
          userId={resetUser.id}
          userName={resetUser.name}
        />
      )}

      <ConfirmDialog
        open={!!deactivateUser}
        onClose={() => setDeactivateUser(null)}
        onConfirm={() => setActive(deactivateUser, false)}
        title="Désactiver le compte"
        message={`${deactivateUser?.name} ne pourra plus se connecter. Son historique est conservé et le compte peut être réactivé à tout moment.`}
        confirmLabel="Désactiver"
        destructive
        loading={isPending}
      />

      <ConfirmDialog
        open={!!reactivateUser}
        onClose={() => setReactivateUser(null)}
        onConfirm={() => setActive(reactivateUser, true)}
        title="Réactiver le compte"
        message={`${reactivateUser?.name} pourra de nouveau se connecter avec son rôle actuel.`}
        confirmLabel="Réactiver"
        loading={isPending}
      />
    </div>
  );
}

function SortHeader({
  k,
  sort,
  onToggle,
  children,
}: {
  k: SortKey;
  sort: Sort;
  onToggle: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = sort.key === k;
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="izi-th-sort" onClick={() => onToggle(k)}>
        {children}
        <svg
          aria-hidden
          viewBox="0 0 10 10"
          className={`h-2.5 w-2.5 ${active ? "opacity-100" : "opacity-0"} ${active && sort.dir === "desc" ? "rotate-180" : ""}`}
        >
          <path d="M5 2 9 7H1z" fill="currentColor" />
        </svg>
      </button>
    </th>
  );
}

function Person({ user, isMe }: { user: UserData; isMe: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-dark ${roleStyle(user.role).tint}`}
      >
        {initials(user.name)}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-dark">{user.name}</span>
          {isMe && <span className="shrink-0 text-[12px] text-izi-gray">(vous)</span>}
          {!user.isActive && (
            <span className="shrink-0 rounded-full border border-border-soft bg-white px-2 text-[11px] font-medium leading-5 text-izi-gray">
              Désactivé
            </span>
          )}
        </div>
        <a href={`mailto:${user.email}`} className="block truncate text-[12px] text-izi-gray hover:text-teal hover:underline">
          {user.email}
        </a>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const s = roleStyle(role);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium text-dark ${s.tint}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function RowActions({
  user,
  isMe,
  onEdit,
  onReset,
  onDeactivate,
  onReactivate,
  touch = false,
}: {
  user: UserData;
  isMe: boolean;
  onEdit: (u: UserData) => void;
  onReset: (u: UserData) => void;
  onDeactivate: (u: UserData) => void;
  onReactivate: (u: UserData) => void;
  touch?: boolean;
}) {
  const base = `rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal ${
    touch ? "min-h-[44px] border border-border-soft px-3 text-[13px]" : "px-2.5 py-1.5 text-[12px]"
  }`;
  if (!user.isActive) {
    return (
      <button
        type="button"
        onClick={() => onReactivate(user)}
        aria-label={`Réactiver ${user.name}`}
        className={`${base} text-teal hover:bg-teal-lt`}
      >
        Réactiver
      </button>
    );
  }
  return (
    <>
      <button type="button" onClick={() => onEdit(user)} aria-label={`Modifier ${user.name}`} className={`${base} text-teal hover:bg-teal-lt`}>
        Modifier
      </button>
      <button
        type="button"
        onClick={() => onReset(user)}
        aria-label={`Réinitialiser le mot de passe de ${user.name}`}
        className={`${base} text-dark-md hover:bg-izi-gray-lt`}
      >
        Mot de passe
      </button>
      {!isMe && (
        <button
          type="button"
          onClick={() => onDeactivate(user)}
          aria-label={`Désactiver ${user.name}`}
          className={`${base} text-izi-red hover:bg-izi-red-lt`}
        >
          Désactiver
        </button>
      )}
    </>
  );
}
