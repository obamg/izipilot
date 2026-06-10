import {
  Body,
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

interface LoginOtpProps {
  name: string;
  code: string;
}

export default function LoginOtp({ name, code }: LoginOtpProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>{`Votre code de connexion IziPilot : ${code}`}</Preview>
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
              Voici votre code de connexion. Saisissez-le sur la page de
              connexion pour finaliser votre authentification.
            </Text>

            <Section style={codeBoxStyle}>
              <Text style={codeStyle}>{code}</Text>
            </Section>

            <Text style={textStyle}>
              Ce code expire dans <strong>10 minutes</strong>. Il ne peut être
              utilisé qu&apos;une seule fois.
            </Text>

            <Text style={warningStyle}>
              ⚠️ Si vous n&apos;êtes pas à l&apos;origine de cette demande,
              ignorez cet email et changez votre mot de passe immédiatement.
            </Text>
          </Section>

          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              IziPilot · IziChange S.A. · Bénin
            </Text>
            <Text style={footerTextStyle}>
              Cet email a été envoyé automatiquement suite à une tentative de
              connexion.
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
  padding: "32px 24px",
  textAlign: "center",
};
const logoStyle: React.CSSProperties = {
  color: "#ffffff",
  fontFamily: "'DM Serif Display', Georgia, serif",
  fontSize: "32px",
  margin: 0,
};
const taglineStyle: React.CSSProperties = {
  color: "#b3e0e0",
  fontFamily: "'DM Serif Display', Georgia, serif",
  fontStyle: "italic",
  fontSize: "13px",
  margin: "6px 0 0 0",
};
const contentStyle: React.CSSProperties = {
  padding: "32px 24px",
};
const titleStyle: React.CSSProperties = {
  color: "#1c3a4a",
  fontFamily: "'DM Serif Display', Georgia, serif",
  fontSize: "22px",
  margin: "0 0 16px 0",
};
const textStyle: React.CSSProperties = {
  color: "#2e3e4b",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px 0",
};
const codeBoxStyle: React.CSSProperties = {
  backgroundColor: "#e6f7f7",
  borderRadius: "12px",
  margin: "24px 0",
  padding: "24px",
  textAlign: "center",
};
const codeStyle: React.CSSProperties = {
  color: "#008081",
  fontFamily: "'DM Mono', 'SF Mono', Consolas, monospace",
  fontSize: "40px",
  fontWeight: 600,
  letterSpacing: "8px",
  margin: 0,
};
const warningStyle: React.CSSProperties = {
  backgroundColor: "#fceaea",
  borderLeft: "4px solid #e23c4a",
  borderRadius: "4px",
  color: "#1c3a4a",
  fontSize: "13px",
  margin: "20px 0 0 0",
  padding: "12px 16px",
};
const hrStyle: React.CSSProperties = {
  border: 0,
  borderTop: "1px solid #e1e8eb",
  margin: 0,
};
const footerStyle: React.CSSProperties = {
  padding: "20px 24px",
  textAlign: "center",
};
const footerTextStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontSize: "11px",
  margin: "4px 0",
};
