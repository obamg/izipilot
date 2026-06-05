"use client";

import { useTransition, useState } from "react";
import {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
} from "@/lib/notification-prefs";
import { saveNotificationPrefs } from "./actions";

interface Props {
  initial: Record<NotificationEvent, boolean>;
}

export function NotificationPrefsForm({ initial }: Props) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: NotificationEvent) {
    setValues((v) => ({ ...v, [key]: !v[key] }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    for (const evt of NOTIFICATION_EVENTS) {
      if (values[evt.key]) fd.set(evt.key, "on");
    }
    setError(null);
    startTransition(async () => {
      const res = await saveNotificationPrefs(fd);
      if (res.ok) {
        setSavedAt(Date.now());
      } else {
        setError(res.error ?? "Erreur");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="bg-white rounded-[10px] border border-border-soft divide-y divide-[#eef2f3]">
        {NOTIFICATION_EVENTS.map((evt) => {
          const checked = values[evt.key];
          return (
            <label
              key={evt.key}
              className="flex items-start gap-3 p-4 cursor-pointer"
            >
              <span className="relative inline-flex shrink-0 mt-0.5">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(evt.key)}
                  className="sr-only peer"
                  aria-label={evt.label}
                />
                <span
                  className={`w-9 h-5 rounded-full transition-colors ${
                    checked ? "bg-teal" : "bg-izi-gray/30"
                  }`}
                />
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                    checked ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-medium text-dark">
                  {evt.label}
                </span>
                <span className="block text-[11px] text-izi-gray mt-0.5">
                  {evt.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-teal hover:bg-teal-dk text-white text-sm font-medium px-4 py-2 rounded-[7px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {savedAt && !pending && (
          <span className="text-[11px] text-izi-green">
            Préférences enregistrées
          </span>
        )}
        {error && (
          <span className="text-[11px] text-izi-red">{error}</span>
        )}
      </div>
    </form>
  );
}
