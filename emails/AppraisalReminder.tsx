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
import type { AppraisalTaskCounts } from "@/lib/appraisal";

interface AppraisalReminderProps {
  name: string;
  quarter: string;
  year: number;
  counts: AppraisalTaskCounts;
  href: string; // path, e.g. "/appraisals"
  appUrl?: string;
}

export default function AppraisalReminder({
  name,
  quarter,
  year,
  counts,
  href,
  appUrl = "https://izipilote.com",
}: AppraisalReminderProps) {
  const items: string[] = [];
  if (counts.toOpen > 0)
    items.push(`${counts.toOpen} bilan(s) à ouvrir pour votre équipe`);
  if (counts.toComplete > 0)
    items.push(`${counts.toComplete} bilan(s) à évaluer (auto-évaluation reçue)`);
  if (counts.selfPending > 0) items.push("Votre auto-évaluation à remplir");
  if (counts.signPending > 0) items.push("Un bilan partagé à signer");

  return (
    <Html lang="fr">
      <Head />
      <Preview>{`Bilans ${quarter} ${year} — ${items.length} action(s) en attente`}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Heading style={logoStyle}>IziPilot</Heading>
            <Text style={taglineStyle}>L&apos;exécution au rythme de vos ambitions</Text>
          </Section>

          <Section style={contentStyle}>
            <Heading as="h2" style={titleStyle}>
              Bonjour {name},
            </Heading>

            <Text style={textStyle}>
              Le trimestre <strong>{quarter} {year}</strong> est terminé — c&apos;est
              le moment des bilans de performance. Voici ce qui vous attend :
            </Text>

            <Section style={listBoxStyle}>
              {items.map((it, i) => (
                <Text key={i} style={listItemStyle}>
                  • {it}
                </Text>
              ))}
            </Section>

            <Text style={textStyle}>
              Le bilan s&apos;appuie sur vos évaluations mensuelles du trimestre :
              chaque note /5 y est déjà agrégée comme contexte.
            </Text>

            <Section style={ctaContainerStyle}>
              <Button style={buttonStyle} href={`${appUrl}${href}`}>
                Ouvrir mes bilans
              </Button>
            </Section>
          </Section>

          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>IziPilot · IziChange S.A. · Bénin</Text>
            <Text style={footerTextStyle}>
              Rappel envoyé automatiquement au début de chaque trimestre.
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

const listBoxStyle: React.CSSProperties = {
  backgroundColor: "#e6f7f7",
  border: "1px solid #b3e0e0",
  borderRadius: "6px",
  padding: "12px 16px",
  margin: "0 0 16px",
};

const listItemStyle: React.CSSProperties = {
  color: "#005f60",
  fontSize: "14px",
  fontWeight: 600,
  margin: "0 0 4px",
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
