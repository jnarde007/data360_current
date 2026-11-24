/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
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

interface OrderConfirmationEmailProps {
  siteName: string
  customerName?: string
  recipientPhone: string
  network: string
  bundleSize: string
  totalAmount: string
  shortId: string
  orderedAt: string
}

export const OrderConfirmationEmail = ({
  siteName,
  customerName,
  recipientPhone,
  network,
  bundleSize,
  totalAmount,
  shortId,
  orderedAt,
}: OrderConfirmationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Order {shortId} received — {bundleSize} {network} data bundle</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src="https://bpntlyplmitxiaounthf.supabase.co/storage/v1/object/public/email-assets/logo.png" width="44" height="44" alt={siteName} style={logo} />
        <Heading style={h1}>Order Received</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hello,'} your order has been placed successfully and is being processed.
        </Text>

        <Section style={detailsBox}>
          <Row style={detailRow}>
            <Column style={detailLabel}>Reference</Column>
            <Column style={detailValue}>{shortId}</Column>
          </Row>
          <Hr style={divider} />
          <Row style={detailRow}>
            <Column style={detailLabel}>Phone Number</Column>
            <Column style={detailValue}>{recipientPhone}</Column>
          </Row>
          <Hr style={divider} />
          <Row style={detailRow}>
            <Column style={detailLabel}>Network</Column>
            <Column style={detailValue}>{network}</Column>
          </Row>
          <Hr style={divider} />
          <Row style={detailRow}>
            <Column style={detailLabel}>Bundle</Column>
            <Column style={detailValue}>{bundleSize}</Column>
          </Row>
          <Hr style={divider} />
          <Row style={detailRow}>
            <Column style={detailLabel}>Amount</Column>
            <Column style={detailValue}>GHS {totalAmount}</Column>
          </Row>
          <Hr style={divider} />
          <Row style={detailRow}>
            <Column style={detailLabel}>Ordered</Column>
            <Column style={detailValue}>{orderedAt}</Column>
          </Row>
        </Section>

        <Text style={text}>
          We'll notify you once your data bundle has been delivered.
        </Text>
        <Text style={footer}>
          Thank you for choosing {siteName}.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default OrderConfirmationEmail

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
const footer = { fontSize: '12px', color: 'hsl(220, 10%, 46%)', margin: '0' }
