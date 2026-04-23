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

interface AlertBlockedProps {
  recipientName: string;
  krTitle: string;
  scorePercent: number;
  entityName: string;
  alertMessage: string;
  appUrl?: string;
}

export default function AlertBlocked({
  recipientName,
  krTitle,
  scorePercent,
  entityName,
  alertMessage,
  appUrl = "https://pilot.izichange.com",
}: AlertBlockedProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>
        {`BLOQUÉ : ${krTitle} est passé en rouge (${scorePercent}%)`}
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

          {/* Alert banner */}
          <Section style={alertBannerStyle}>
            <Text style={alertBannerTextStyle}>ALERTE — KR BLOQUÉ</Text>
          </Section>

          {/* Content */}
          <Section style={contentStyle}>
            <Heading as="h2" style={titleStyle}>
              Bonjour {recipientName},
            </Heading>

            <Text style={textStyle}>
              Un Key Result vient de passer au statut{" "}
              <strong style={{ color: "#e23c4a" }}>BLOQUÉ</strong> et nécessite
              votre attention immédiate.
            </Text>

            {/* KR Card */}
            <Section style={krCardStyle}>
              <Text style={krLabelStyle}>Key Result</Text>
              <Text style={krTitleStyle}>{krTitle}</Text>

              <Section style={krMetaStyle}>
                <Text style={krEntityStyle}>{entityName}</Text>
                <Text style={krScoreStyle}>{scorePercent}%</Text>
              </Section>

              <Section style={scoreBarContainerStyle}>
                <Section
                  style={{
                    ...scoreBarFillStyle,
                    width: `${Math.min(scorePercent, 100)}%`,
                  }}
                />
              </Section>

              <Text style={alertMessageStyle}>{alertMessage}</Text>
            </Section>

            <Text style={textStyle}>
              Une escalade sera déclenchée automatiquement si ce KR reste
              bloqué plus de <strong>48 heures</strong> sans résolution.
            </Text>

            <Section style={ctaContainerStyle}>
              <Button style={buttonStyle} href={`${appUrl}/alerts`}>
                Voir les alertes et prendre une décision
              </Button>
            </Section>
          </Section>

          {/* Footer */}
          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              IziPilot · IziChange S.A. · Bénin
            </Text>
            <Text style={footerTextStyle}>
              Cet email a été envoyé automatiquement suite au passage du KR en statut BLOQUÉ.
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

const alertBannerStyle: React.CSSProperties = {
  backgroundColor: "#e23c4a",
  padding: "10px 32px",
  textAlign: "center",
};

const alertBannerTextStyle: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "1px",
  margin: 0,
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

const krCardStyle: React.CSSProperties = {
  backgroundColor: "#fceaea",
  border: "1px solid #e23c4a",
  borderRadius: "8px",
  margin: "0 0 24px",
  padding: "16px 20px",
};

const krLabelStyle: React.CSSProperties = {
  color: "#e23c4a",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "1px",
  margin: "0 0 4px",
  textTransform: "uppercase",
};

const krTitleStyle: React.CSSProperties = {
  color: "#1c3a4a",
  fontSize: "16px",
  fontWeight: 600,
  margin: "0 0 12px",
};

const krMetaStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: "8px",
};

const krEntityStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontSize: "13px",
  margin: 0,
};

const krScoreStyle: React.CSSProperties = {
  color: "#e23c4a",
  fontFamily: "'DM Mono', monospace",
  fontSize: "18px",
  fontWeight: 700,
  margin: 0,
};

const scoreBarContainerStyle: React.CSSProperties = {
  backgroundColor: "#f2f6f7",
  borderRadius: "4px",
  height: "6px",
  margin: "0 0 12px",
  overflow: "hidden",
};

const scoreBarFillStyle: React.CSSProperties = {
  backgroundColor: "#e23c4a",
  borderRadius: "4px",
  height: "6px",
};

const alertMessageStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontSize: "13px",
  margin: 0,
};

const ctaContainerStyle: React.CSSProperties = {
  margin: "8px 0 0",
  textAlign: "center",
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#e23c4a",
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
