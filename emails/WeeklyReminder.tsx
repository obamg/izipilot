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

interface WeeklyReminderProps {
  name: string;
  weekNumber: number;
  year: number;
  appUrl?: string;
}

export default function WeeklyReminder({
  name,
  weekNumber,
  year,
  appUrl = "https://izipilote.com",
}: WeeklyReminderProps) {
  const deadline = "09h00";

  return (
    <Html lang="fr">
      <Head />
      <Preview>
        {`Rappel : soumettez votre revue OKR avant ${deadline} — Semaine ${weekNumber}`}
      </Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Header */}
          <Section style={headerStyle}>
            <Heading style={logoStyle}>IziPilot</Heading>
            <Text style={taglineStyle}>
              L&apos;exécution au rythme de vos ambitions
            </Text>
          </Section>

          {/* Content */}
          <Section style={contentStyle}>
            <Heading as="h2" style={titleStyle}>
              Bonjour {name},
            </Heading>

            <Text style={textStyle}>
              C&apos;est lundi matin — il est temps de soumettre votre revue OKR
              hebdomadaire avant <strong>{deadline}</strong>.
            </Text>

            <Section style={weekBadgeContainerStyle}>
              <Text style={weekBadgeStyle}>
                Semaine {weekNumber} · {year}
              </Text>
            </Section>

            <Text style={textStyle}>
              Prenez quelques minutes pour mettre à jour vos Key Results :
            </Text>

            <ul style={listStyle}>
              <li style={listItemStyle}>Renseignez la valeur actuelle de chaque KR</li>
              <li style={listItemStyle}>Identifiez les blocages éventuels</li>
              <li style={listItemStyle}>Précisez vos besoins pour débloquer la situation</li>
            </ul>

            <Section style={ctaContainerStyle}>
              <Button style={buttonStyle} href={`${appUrl}/weekly`}>
                Soumettre ma revue OKR
              </Button>
            </Section>

            <Text style={warningStyle}>
              ⚠️ Les saisies manquantes après {deadline} déclenchent une alerte
              automatique auprès du Management.
            </Text>
          </Section>

          {/* Footer */}
          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              IziPilot · IziChange S.A. · Bénin
            </Text>
            <Text style={footerTextStyle}>
              Cet email est envoyé automatiquement chaque lundi matin.
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

const weekBadgeContainerStyle: React.CSSProperties = {
  margin: "0 0 16px",
};

const weekBadgeStyle: React.CSSProperties = {
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

const listStyle: React.CSSProperties = {
  color: "#2e3e4b",
  fontSize: "15px",
  lineHeight: "1.8",
  paddingLeft: "20px",
};

const listItemStyle: React.CSSProperties = {
  marginBottom: "4px",
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

const warningStyle: React.CSSProperties = {
  backgroundColor: "#fffbe6",
  border: "1px solid #f4a900",
  borderRadius: "6px",
  color: "#2e3e4b",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "16px 0 0",
  padding: "12px 16px",
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
