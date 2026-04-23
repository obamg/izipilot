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

interface Escalation48hProps {
  recipientName: string;
  krTitle: string;
  scorePercent: number;
  entityName: string;
  blockedSince: string; // ISO date string or human-readable
  appUrl?: string;
}

export default function Escalation48h({
  recipientName,
  krTitle,
  scorePercent,
  entityName,
  blockedSince,
  appUrl = "https://pilot.izichange.com",
}: Escalation48hProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>
        ESCALADE URGENTE : {krTitle} est bloqué depuis plus de 48h
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

          {/* Escalation banner */}
          <Section style={escalationBannerStyle}>
            <Text style={escalationBannerTextStyle}>
              ESCALADE — ACTION REQUISE SOUS 24H
            </Text>
          </Section>

          {/* Content */}
          <Section style={contentStyle}>
            <Heading as="h2" style={titleStyle}>
              Bonjour {recipientName},
            </Heading>

            <Text style={textStyle}>
              Un Key Result est resté en statut{" "}
              <strong style={{ color: "#e23c4a" }}>BLOQUÉ</strong> depuis plus
              de <strong>48 heures</strong> sans résolution. Ce cas nécessite
              une décision de votre part en urgence.
            </Text>

            {/* KR Escalation Card */}
            <Section style={escalationCardStyle}>
              <Text style={escalationLabelStyle}>ESCALADE 48H</Text>
              <Text style={krTitleStyle}>{krTitle}</Text>

              <Section style={metaRowStyle}>
                <Text style={metaItemStyle}>
                  Entité :{" "}
                  <strong style={{ color: "#1c3a4a" }}>{entityName}</strong>
                </Text>
                <Text style={metaItemStyle}>
                  Score :{" "}
                  <strong
                    style={{
                      color: "#e23c4a",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    {scorePercent}%
                  </strong>
                </Text>
              </Section>

              <Text style={blockedSinceStyle}>
                Bloqué depuis le{" "}
                <strong>
                  {new Date(blockedSince).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
              </Text>
            </Section>

            <Text style={textStyle}>
              En tant que responsable, vous devez prendre une décision et
              documenter l&apos;action corrective dans IziPilot pour clore cette
              alerte.
            </Text>

            <Section style={actionsStyle}>
              <Heading as="h3" style={actionsTitle}>
                Actions attendues
              </Heading>
              <ul style={listStyle}>
                <li style={listItemStyle}>
                  Contacter le PO responsable du KR pour comprendre le blocage
                </li>
                <li style={listItemStyle}>
                  Décider d&apos;une action corrective ou d&apos;un recalibrage de la
                  cible
                </li>
                <li style={listItemStyle}>
                  Documenter la décision dans IziPilot et clore l&apos;alerte
                </li>
              </ul>
            </Section>

            <Section style={ctaContainerStyle}>
              <Button style={buttonPrimaryStyle} href={`${appUrl}/alerts`}>
                Traiter l&apos;escalade maintenant
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
              Escalade déclenchée automatiquement après 48h sans résolution de
              l&apos;alerte KR_BLOCKED.
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

const escalationBannerStyle: React.CSSProperties = {
  backgroundColor: "#1c3a4a",
  borderTop: "3px solid #e23c4a",
  padding: "10px 32px",
  textAlign: "center",
};

const escalationBannerTextStyle: React.CSSProperties = {
  color: "#e23c4a",
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

const escalationCardStyle: React.CSSProperties = {
  backgroundColor: "#fceaea",
  border: "2px solid #e23c4a",
  borderRadius: "8px",
  margin: "0 0 24px",
  padding: "16px 20px",
};

const escalationLabelStyle: React.CSSProperties = {
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

const metaRowStyle: React.CSSProperties = {
  margin: "0 0 12px",
};

const metaItemStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontSize: "13px",
  margin: "0 0 4px",
};

const blockedSinceStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "4px",
  color: "#5f6e7a",
  fontSize: "13px",
  margin: 0,
  padding: "8px 12px",
};

const actionsStyle: React.CSSProperties = {
  backgroundColor: "#e6f7f7",
  border: "1px solid #b3e0e0",
  borderRadius: "8px",
  margin: "0 0 24px",
  padding: "16px 20px",
};

const actionsTitle: React.CSSProperties = {
  color: "#005f60",
  fontSize: "14px",
  fontWeight: 600,
  margin: "0 0 8px",
};

const listStyle: React.CSSProperties = {
  color: "#2e3e4b",
  fontSize: "14px",
  lineHeight: "1.7",
  margin: 0,
  paddingLeft: "20px",
};

const listItemStyle: React.CSSProperties = {
  marginBottom: "4px",
};

const ctaContainerStyle: React.CSSProperties = {
  textAlign: "center",
};

const buttonPrimaryStyle: React.CSSProperties = {
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
