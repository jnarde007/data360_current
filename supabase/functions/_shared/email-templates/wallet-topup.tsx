/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Column,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface WalletTopupEmailProps {
  siteName: string
  siteUrl: string
  customerName?: string
  amount: string
  newBalance: string
  method: string
  shortId: string
  approvedAt: string
}

export const WalletTopupEmail = ({
  siteName,
  siteUrl,
  customerName,
  amount,
  newBalance,
  method,
  shortId,
  approvedAt,
}: WalletTopupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>GHS {amount} has been added to your {siteName} wallet — {shortId}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src="https://bpntlyplmitxiaounthf.supabase.co/storage/v1/object/public/email-assets/logo.png" width="44" height="44" alt={siteName} style={logo} />
        <Heading style={h1}>Wallet Top-up Confirmed</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hello,'} your wallet has been credited successfully.
        </Text>

        <Section style={detailsBox}>
          <Row style={detailRow}>
            <Column style={detailLabel}>Reference</Column>
            <Column style={detailValue}>{shortId}</Column>
          </Row>
          <Hr style={divider} />
          <Row style={detailRow}>
            <Column style={detailLabel}>Amount</Column>
            <Column style={detailValue}>GHS {amount}</Column>
          </Row>
          <Hr style={divider} />
          <Row style={detailRow}>
            <Column style={detailLabel}>Method</Column>
            <Column style={detailValue}>{method}</Column>
          </Row>
          <Hr style={divider} />
          <Row style={detailRow}>
            <Column style={detailLabel}>New Balance</Column>
            <Column style={detailValue}>GHS {newBalance}</Column>
          </Row>
          <Hr style={divider} />
          <Row style={detailRow}>
            <Column style={detailLabel}>Approved</Column>
            <Column style={detailValue}>{approvedAt}</Column>
          </Row>
        </Section>

        <Button style={button} href={siteUrl}>
          Buy Data Now
        </Button>
        <Text style={footer}>
          Thank you for choosing {siteName}.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default WalletTopupEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 28px' }
const logo = { borderRadius: '12px', marginBottom: '24px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: 'hsl(222, 28%, 12%)', margin: '0 0 16px' }
const text = { fontSize: '14px', color: 'hsl(220, 10%, 46%)', lineHeight: '1.6', margin: '0 0 24px' }
const detailsBox = { backgroundColor: '#F9FAFB', borderRadius: '12px', padding: '16px 20px', margin: '0 0 24px' }
const detailRow = { padding: '8px 0' }
const detailLabel = { fontSize: '13px', color: 'hsl(220, 10%, 46%)', width: '120px', verticalAlign: 'top' as const }
const detailValue = { fontSize: '14px', color: 'hsl(222, 28%, 12%)', fontWeight: '500' as const, textAlign: 'right' as const, verticalAlign: 'top' as const }
const divider = { borderColor: '#F3F4F6', margin: '0' }
const button = {
  backgroundColor: 'hsl(217, 72%, 50%)',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '12px',
  padding: '12px 24px',
  textDecoration: 'none',
  fontWeight: '500' as const,
}
const footer = { fontSize: '12px', color: 'hsl(220, 10%, 46%)', margin: '0' }
