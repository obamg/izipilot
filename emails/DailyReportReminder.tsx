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

interface DailyReportReminderProps {
  name: string;
  dateLabel: string; // e.g. "mardi 13 août"
  sprintName: string;
  sprintCount: number; // number of active sprints still awaiting this user's report
  href: string; // deep link to the sprint (Rapport quotidien tab)
}

export default function DailyReportReminder({
  name,
  dateLabel,
  sprintName,
  sprintCount,
  href,
}: DailyReportReminderProps) {
  const multi = sprintCount > 1;
  return (
    <Html lang="fr">
      <Head />
      <Preview>{`Rapport quotidien du ${dateLabel} — à remplir`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Heading style={logoStyle}>IziPilot</Heading>
            <Text style={taglineStyle}>
              L&apos;exécution au rythme de vos ambitions
            </Text>
          </Section>

          <Section style={contentStyle}>
            <Heading as="h2" style={titleStyle}>
              Bonjour {name},
            </Heading>

            <Text style={textStyle}>
              Pensez à remplir votre <strong>rapport quotidien</strong> pour{" "}
              <strong>{dateLabel}</strong> : ce que vous avez fait hier, ce que
              vous prévoyez aujourd&apos;hui, et vos éventuels blocages.
            </Text>

            <Section style={badgeContainerStyle}>
              <Text style={badgeStyle}>
                {multi
                  ? `${sprintCount} sprints actifs en attente`
                  : `Sprint : ${sprintName}`}
              </Text>
            </Section>

            <Text style={textStyle}>
              Un blocage signalé remonte immédiatement à l&apos;équipe — c&apos;est
              le meilleur moyen d&apos;être débloqué vite.
            </Text>

            <Section style={ctaContainerStyle}>
              <Button style={buttonStyle} href={href}>
                Remplir mon rapport
              </Button>
            </Section>
          </Section>

          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>IziPilot · IziChange S.A. · Bénin</Text>
            <Text style={footerTextStyle}>
              Rappel envoyé chaque jour ouvré à 9h. Gérez vos préférences dans
              Paramètres → Notifications.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ============================================================================
// Styles
// ============================================================================

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

const badgeContainerStyle: React.CSSProperties = {
  margin: "0 0 16px",
};

const badgeStyle: React.CSSProperties = {
  backgroundColor: "#e6f7f7",
  border: "1px solid #b3e0e0",
  borderRadius: "6px",
  color: "#005f60",
  display: "inline-block",
  fontFamily: "'DM Mono', monospace",
  fontSize: "14px",
  fontWeight: 600,
  margin: 0,
  padding: "8px 16px",
};

const ctaContainerStyle: React.CSSProperties = {
  margin: "24px 0",
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
