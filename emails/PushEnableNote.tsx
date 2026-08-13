import { Link, Section, Text } from "@react-email/components";
import * as React from "react";

/**
 * Compact, single-line invitation to enable browser/mobile push, embedded in
 * the low-frequency emails that already go out (weekly reminder → POs, weekly
 * digest → Management/CEO). Zero extra send cost — it just bootstraps push
 * adoption so the daily-report reminder (push-only) actually reaches people.
 */
export function PushEnableNote({
  appUrl = "https://izipilote.com",
}: {
  appUrl?: string;
}) {
  return (
    <Section style={noteStyle}>
      <Text style={noteTextStyle}>
        🔔 <strong>Nouveau :</strong> activez les notifications pour recevoir vos
        rappels de rapport quotidien et vos alertes KR en direct — sur mobile ou
        navigateur, sans email.{" "}
        <Link style={noteLinkStyle} href={`${appUrl}/settings/notifications`}>
          Activer les notifications →
        </Link>
      </Text>
    </Section>
  );
}

const noteStyle: React.CSSProperties = {
  backgroundColor: "#e6f7f7",
  border: "1px solid #b3e0e0",
  borderRadius: "6px",
  margin: "24px 0 0",
  padding: "12px 16px",
};

const noteTextStyle: React.CSSProperties = {
  color: "#2e3e4b",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: 0,
};

const noteLinkStyle: React.CSSProperties = {
  color: "#008081",
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};
