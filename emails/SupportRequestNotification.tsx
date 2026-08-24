import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

export type SupportEmailKind = "NEW" | "UPDATE" | "OVERDUE";

interface SupportRequestNotificationProps {
  kind: SupportEmailKind;
  recipientName: string;
  reference: string;
  title: string;
  departmentName: string;
  categoryLabel: string;
  priorityLabel: string;
  statusLabel: string;
  requesterName: string;
  assigneeName?: string | null;
  /** Phrase de contexte : "Statut passé à Résolue", extrait du commentaire… */
  message?: string | null;
  /** Échéance formatée, affichée sur les relances de retard. */
  dueLabel?: string | null;
  href: string;
  appUrl?: string;
}

const HEADLINE: Record<SupportEmailKind, string> = {
  NEW: "Nouvelle demande",
  UPDATE: "Mise à jour de votre demande",
  OVERDUE: "Demande en retard",
};

export default function SupportRequestNotification({
  kind,
  recipientName,
  reference,
  title,
  departmentName,
  categoryLabel,
  priorityLabel,
  statusLabel,
  requesterName,
  assigneeName,
  message,
  dueLabel,
  href,
  appUrl = "https://izipilote.com",
}: SupportRequestNotificationProps) {
  const isOverdue = kind === "OVERDUE";
  const intro =
    kind === "NEW"
      ? `${requesterName} vient de déposer une demande auprès du ${departmentName}.`
      : kind === "OVERDUE"
        ? `Cette demande a dépassé son échéance et attend toujours un traitement.`
        : `Votre demande auprès du ${departmentName} a évolué.`;

  return (
    <Html lang="fr">
      <Head />
      <Preview>{`${reference} — ${title}`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Heading style={logoStyle}>IziPilot</Heading>
            <Text style={taglineStyle}>L&apos;exécution au rythme de vos ambitions</Text>
          </Section>

          <Section style={contentStyle}>
            <Heading as="h2" style={titleStyle}>
              {HEADLINE[kind]}
            </Heading>

            <Text style={textStyle}>
              Bonjour {recipientName}, {intro}
            </Text>

            <Section style={isOverdue ? alertBoxStyle : infoBoxStyle}>
              <Text style={refStyle}>{reference}</Text>
              <Text style={requestTitleStyle}>{title}</Text>
              <Text style={metaStyle}>
                {categoryLabel} · Priorité {priorityLabel} · Statut : {statusLabel}
              </Text>
              <Text style={metaStyle}>
                Demandeur : {requesterName}
                {assigneeName ? ` · En charge : ${assigneeName}` : " · Non assignée"}
              </Text>
              {dueLabel && <Text style={metaStyle}>Échéance : {dueLabel}</Text>}
            </Section>

            {message && <Text style={messageStyle}>{message}</Text>}

            <Section style={ctaContainerStyle}>
              <Button style={buttonStyle} href={`${appUrl}${href}`}>
                Ouvrir la demande
              </Button>
            </Section>
          </Section>

          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>IziPilot · IziChange S.A. · Bénin</Text>
            <Text style={footerTextStyle}>
              Vous pouvez désactiver ces emails dans Paramètres → Notifications.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle: React.CSSProperties = {
  backgroundColor: "#f2f6f7",
  fontFamily: "'DM Sans', Arial, sans-serif",
  margin: 0,
  padding: "20px 0",
};

const containerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  maxWidth: "560px",
  margin: "0 auto",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  backgroundColor: "#1c3a4a",
  padding: "24px 32px",
  textAlign: "center",
};

const logoStyle: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "24px",
  fontWeight: 700,
  margin: "0 0 4px",
  letterSpacing: "0.5px",
};

const taglineStyle: React.CSSProperties = {
  color: "#b3e0e0",
  fontSize: "12px",
  margin: 0,
  fontStyle: "italic",
};

const contentStyle: React.CSSProperties = {
  padding: "32px",
};

const titleStyle: React.CSSProperties = {
  color: "#1c3a4a",
  fontSize: "20px",
  fontWeight: 600,
  margin: "0 0 16px",
};

const textStyle: React.CSSProperties = {
  color: "#2e3e4b",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const infoBoxStyle: React.CSSProperties = {
  backgroundColor: "#e6f7f7",
  border: "1px solid #b3e0e0",
  borderRadius: "6px",
  padding: "14px 16px",
  margin: "0 0 16px",
};

const alertBoxStyle: React.CSSProperties = {
  backgroundColor: "#fceaea",
  border: "1px solid #e23c4a",
  borderRadius: "6px",
  padding: "14px 16px",
  margin: "0 0 16px",
};

const refStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontFamily: "'DM Mono', monospace",
  fontSize: "12px",
  letterSpacing: "0.5px",
  margin: "0 0 4px",
};

const requestTitleStyle: React.CSSProperties = {
  color: "#1c3a4a",
  fontSize: "16px",
  fontWeight: 600,
  lineHeight: "1.4",
  margin: "0 0 8px",
};

const metaStyle: React.CSSProperties = {
  color: "#2e3e4b",
  fontSize: "13px",
  margin: "0 0 2px",
};

const messageStyle: React.CSSProperties = {
  backgroundColor: "#f2f6f7",
  borderLeft: "3px solid #008081",
  color: "#2e3e4b",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 16px",
  padding: "10px 14px",
};

const ctaContainerStyle: React.CSSProperties = {
  margin: "24px 0 0",
  textAlign: "center",
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#008081",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: 600,
  padding: "12px 28px",
  textDecoration: "none",
};

const hrStyle: React.CSSProperties = {
  borderColor: "#e6f7f7",
  margin: "0",
};

const footerStyle: React.CSSProperties = {
  padding: "16px 32px",
  textAlign: "center",
};

const footerTextStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontSize: "12px",
  margin: "0 0 4px",
};
