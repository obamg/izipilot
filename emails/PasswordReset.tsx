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

interface PasswordResetProps {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export default function PasswordReset({
  name,
  resetUrl,
  expiresInMinutes,
}: PasswordResetProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>Réinitialisez votre mot de passe IziPilot</Preview>
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
              Vous avez demandé à réinitialiser votre mot de passe IziPilot.
              Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de
              passe.
            </Text>

            <Section style={ctaContainerStyle}>
              <Button style={buttonStyle} href={resetUrl}>
                Réinitialiser mon mot de passe
              </Button>
            </Section>

            <Text style={mutedStyle}>
              Ce lien expire dans <strong>{expiresInMinutes} minutes</strong> et
              ne peut être utilisé qu&apos;une seule fois.
            </Text>

            <Text style={mutedStyle}>
              Si le bouton ne fonctionne pas, copiez ce lien dans votre
              navigateur :
            </Text>
            <Text style={linkFallbackStyle}>{resetUrl}</Text>

            <Text style={warningStyle}>
              Si vous n&apos;êtes pas à l&apos;origine de cette demande, ignorez
              cet email — votre mot de passe actuel reste inchangé.
            </Text>
          </Section>

          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              IziPilot · IziChange S.A. · Bénin
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

const mutedStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 8px",
};

const linkFallbackStyle: React.CSSProperties = {
  color: "#005f60",
  fontFamily: "'DM Mono', monospace",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "0 0 16px",
  wordBreak: "break-all",
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
