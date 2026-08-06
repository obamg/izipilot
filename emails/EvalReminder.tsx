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

interface EvalReminderProps {
  name: string;
  monthLabel: string;
  year: number;
  remaining: number;
  total: number;
  appUrl?: string;
}

export default function EvalReminder({
  name,
  monthLabel,
  year,
  remaining,
  total,
  appUrl = "https://izipilote.com",
}: EvalReminderProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>
        {`Évaluations ${monthLabel} ${year} : ${remaining} collègue(s) à noter`}
      </Preview>
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
              Le mois est terminé — il est temps d&apos;évaluer votre équipe pour{" "}
              <strong>
                {monthLabel} {year}
              </strong>
              . Chaque note est basée sur la livraison réelle (points livrés vs
              engagés) affichée à côté de chaque collègue.
            </Text>

            <Section style={badgeContainerStyle}>
              <Text style={badgeStyle}>
                {remaining} / {total} collègue(s) à évaluer
              </Text>
            </Section>

            <Text style={textStyle}>
              Pour chaque personne : vérifiez ses statistiques du mois, puis
              notez Qualité, Collaboration et Initiative. Le score global /5 est
              calculé automatiquement.
            </Text>

            <Section style={ctaContainerStyle}>
              <Button style={buttonStyle} href={`${appUrl}/evaluations`}>
                Évaluer mon équipe
              </Button>
            </Section>
          </Section>

          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>IziPilot · IziChange S.A. · Bénin</Text>
            <Text style={footerTextStyle}>
              Rappel envoyé automatiquement en début de mois.
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
