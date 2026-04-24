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

export interface DigestKr {
  title: string;
  entityName: string;
  scorePercent: number;
  status: "ON_TRACK" | "AT_RISK" | "BLOCKED" | "NOT_STARTED";
}

export interface DigestDecision {
  title: string;
  ownerName: string;
  dueDate?: string;
}

interface WeeklyDigestProps {
  recipientName: string;
  weekNumber: number;
  year: number;
  totalKrs: number;
  onTrackCount: number;
  atRiskCount: number;
  blockedCount: number;
  blockedKrs: DigestKr[];
  pendingDecisions: DigestDecision[];
  appUrl?: string;
}

const STATUS_CONFIG = {
  ON_TRACK: { label: "En bonne voie", color: "#1d9e75", bg: "#e1f5ee" },
  AT_RISK: { label: "Attention", color: "#f4a900", bg: "#fffbe6" },
  BLOCKED: { label: "Bloqué", color: "#e23c4a", bg: "#fceaea" },
  NOT_STARTED: { label: "Non démarré", color: "#5f6e7a", bg: "#f2f6f7" },
} as const;

export default function WeeklyDigest({
  recipientName,
  weekNumber,
  year,
  totalKrs,
  onTrackCount,
  atRiskCount,
  blockedCount,
  blockedKrs,
  pendingDecisions,
  appUrl = "https://izipilote.com",
}: WeeklyDigestProps) {
  const onTrackPct =
    totalKrs > 0 ? Math.round((onTrackCount / totalKrs) * 100) : 0;

  return (
    <Html lang="fr">
      <Head />
      <Preview>
        {`Digest OKR — Semaine ${weekNumber} · ${onTrackPct}% des KRs en bonne voie`}
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

          {/* Week badge */}
          <Section style={weekHeaderStyle}>
            <Text style={weekLabelStyle}>
              Digest hebdomadaire · Semaine {weekNumber} · {year}
            </Text>
          </Section>

          {/* Content */}
          <Section style={contentStyle}>
            <Heading as="h2" style={titleStyle}>
              Bonjour {recipientName},
            </Heading>

            <Text style={textStyle}>
              Voici le résumé OKR de la semaine {weekNumber}. Sur{" "}
              <strong>{totalKrs} Key Results</strong> actifs,{" "}
              <strong style={{ color: "#1d9e75" }}>{onTrackPct}%</strong> sont
              en bonne voie.
            </Text>

            {/* KPI Summary */}
            <Section style={kpiRowStyle}>
              <Section style={kpiCardStyle}>
                <Text style={kpiNumberStyle(onTrackCount, "#1d9e75")}>
                  {onTrackCount}
                </Text>
                <Text style={kpiLabelStyle}>En bonne voie</Text>
              </Section>
              <Section style={kpiCardStyle}>
                <Text style={kpiNumberStyle(atRiskCount, "#f4a900")}>
                  {atRiskCount}
                </Text>
                <Text style={kpiLabelStyle}>Attention</Text>
              </Section>
              <Section style={kpiCardStyle}>
                <Text style={kpiNumberStyle(blockedCount, "#e23c4a")}>
                  {blockedCount}
                </Text>
                <Text style={kpiLabelStyle}>Bloqués</Text>
              </Section>
            </Section>

            {/* Blocked KRs */}
            {blockedKrs.length > 0 && (
              <>
                <Heading as="h3" style={sectionTitleStyle}>
                  KRs nécessitant une attention immédiate
                </Heading>
                {blockedKrs.map((kr, i) => {
                  const config = STATUS_CONFIG[kr.status];
                  return (
                    <Section key={i} style={krRowStyle(config.bg, config.color)}>
                      <Section style={krRowInnerStyle}>
                        <Section style={krInfoStyle}>
                          <Text style={krTitleStyle}>{kr.title}</Text>
                          <Text style={krEntityStyle}>{kr.entityName}</Text>
                        </Section>
                        <Section style={krScoreContainerStyle}>
                          <Text style={krScoreStyle(config.color)}>
                            {kr.scorePercent}%
                          </Text>
                          <Text style={krStatusStyle(config.color)}>
                            {config.label}
                          </Text>
                        </Section>
                      </Section>
                    </Section>
                  );
                })}
              </>
            )}

            {/* Pending Decisions */}
            {pendingDecisions.length > 0 && (
              <>
                <Heading as="h3" style={sectionTitleStyle}>
                  Décisions en attente ({pendingDecisions.length})
                </Heading>
                {pendingDecisions.map((decision, i) => (
                  <Section key={i} style={decisionRowStyle}>
                    <Text style={decisionTitleStyle}>{decision.title}</Text>
                    <Text style={decisionMetaStyle}>
                      Responsable : {decision.ownerName}
                      {decision.dueDate && (
                        <>
                          {" "}
                          · Échéance :{" "}
                          {new Date(decision.dueDate).toLocaleDateString(
                            "fr-FR",
                            { day: "numeric", month: "long" }
                          )}
                        </>
                      )}
                    </Text>
                  </Section>
                ))}
              </>
            )}

            <Section style={ctaContainerStyle}>
              <Button style={buttonStyle} href={`${appUrl}/synthesis`}>
                Voir la synthèse complète
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
              Digest envoyé chaque lundi après la deadline de saisie.
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
  maxWidth: "580px",
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

const weekHeaderStyle: React.CSSProperties = {
  backgroundColor: "#e6f7f7",
  padding: "10px 32px",
  textAlign: "center",
};

const weekLabelStyle: React.CSSProperties = {
  color: "#005f60",
  fontFamily: "'DM Mono', monospace",
  fontSize: "13px",
  fontWeight: 600,
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
  margin: "0 0 24px",
};

const kpiRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "12px",
  margin: "0 0 32px",
};

const kpiCardStyle: React.CSSProperties = {
  backgroundColor: "#f2f6f7",
  borderRadius: "8px",
  flex: "1",
  padding: "16px",
  textAlign: "center",
};

const kpiNumberStyle = (
  value: number,
  color: string
): React.CSSProperties => ({
  color: value > 0 ? color : "#5f6e7a",
  fontFamily: "'DM Mono', monospace",
  fontSize: "28px",
  fontWeight: 700,
  margin: "0 0 4px",
});

const kpiLabelStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontSize: "12px",
  margin: 0,
};

const sectionTitleStyle: React.CSSProperties = {
  color: "#1c3a4a",
  fontSize: "15px",
  fontWeight: 600,
  margin: "0 0 12px",
};

const krRowStyle = (bg: string, border: string): React.CSSProperties => ({
  backgroundColor: bg,
  border: `1px solid ${border}`,
  borderRadius: "6px",
  marginBottom: "8px",
  padding: "12px 16px",
});

const krRowInnerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
};

const krInfoStyle: React.CSSProperties = {
  flex: "1",
};

const krTitleStyle: React.CSSProperties = {
  color: "#1c3a4a",
  fontSize: "14px",
  fontWeight: 600,
  margin: "0 0 2px",
};

const krEntityStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontSize: "12px",
  margin: 0,
};

const krScoreContainerStyle: React.CSSProperties = {
  textAlign: "right",
};

const krScoreStyle = (color: string): React.CSSProperties => ({
  color,
  fontFamily: "'DM Mono', monospace",
  fontSize: "16px",
  fontWeight: 700,
  margin: "0 0 2px",
});

const krStatusStyle = (color: string): React.CSSProperties => ({
  color,
  fontSize: "11px",
  fontWeight: 600,
  margin: 0,
});

const decisionRowStyle: React.CSSProperties = {
  borderBottom: "1px solid #e6f7f7",
  margin: "0 0 8px",
  paddingBottom: "8px",
};

const decisionTitleStyle: React.CSSProperties = {
  color: "#1c3a4a",
  fontSize: "14px",
  fontWeight: 600,
  margin: "0 0 2px",
};

const decisionMetaStyle: React.CSSProperties = {
  color: "#5f6e7a",
  fontSize: "12px",
  margin: 0,
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
