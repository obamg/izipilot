"use client";

import { useState } from "react";
import type { ActionPriority } from "@prisma/client";

interface ActionFormProps {
  krId: string;
  users: { id: string; name: string }[];
  allUsers?: { id: string; name: string }[];
  currentUserId: string;
  onSubmit: (data: {
    krId: string;
    title: string;
    description?: string;
    assigneeId: string;
    priority: ActionPriority;
    dueDate?: string;
  }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function ActionForm({
  krId,
  users,
  allUsers,
  currentUserId,
  onSubmit,
  onCancel,
  isLoading = false,
}: ActionFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [priority, setPriority] = useState<ActionPriority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      krId,
      title: title.trim(),
      description: description.trim() || undefined,
      assigneeId,
      priority,
      dueDate: dueDate || undefined,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[10px] border border-teal-md bg-teal-lt p-3 space-y-2"
    >
      {/* Title */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titre de l'action..."
        className="w-full rounded-[7px] border border-[#deeaea] bg-white px-2.5 py-1.5 text-[13px] text-dark placeholder:text-izi-gray focus:outline-none focus:border-teal"
        required
        minLength={2}
        maxLength={200}
        autoFocus
        aria-label="Titre de l'action"
      />

      {/* Description */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optionnel)"
        rows={2}
        className="w-full rounded-[7px] border border-[#deeaea] bg-white px-2.5 py-1.5 text-[13px] text-dark placeholder:text-izi-gray focus:outline-none focus:border-teal resize-none"
        maxLength={500}
        aria-label="Description"
      />

      {/* Row: Assignee + Priority + Due Date */}
      <div className="flex flex-wrap gap-2">
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="flex-1 min-w-[120px] rounded-[7px] border border-[#deeaea] bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
          aria-label="Responsable"
        >
          {allUsers && allUsers !== users ? (
            <>
              <optgroup label="Membres du d\u00e9partement">
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </optgroup>
              <optgroup label="Autres utilisateurs">
                {allUsers
                  .filter((u) => !users.some((m) => m.id === u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
              </optgroup>
            </>
          ) : (
            users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))
          )}
        </select>

        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as ActionPriority)}
          className="rounded-[7px] border border-[#deeaea] bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
          aria-label="Priorité"
        >
          <option value="LOW">Basse</option>
          <option value="MEDIUM">Moyenne</option>
          <option value="HIGH">Haute</option>
          <option value="URGENT">Urgente</option>
        </select>

        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-[7px] border border-[#deeaea] bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
          aria-label="Date limite"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 rounded-[7px] text-[12px] font-medium text-izi-gray border border-[#deeaea] bg-white hover:bg-gray-lt transition-colors"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={isLoading || !title.trim()}
          className="px-3 py-1 rounded-[7px] text-[12px] font-medium text-white bg-teal hover:bg-teal-dk transition-colors disabled:opacity-50"
        >
          {isLoading ? "..." : "Ajouter"}
        </button>
      </div>
    </form>
  );
}
