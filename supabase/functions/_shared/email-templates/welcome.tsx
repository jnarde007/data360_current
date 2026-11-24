/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface WelcomeEmailProps {
  siteName: string
  siteUrl: string
  customerName?: string
}

export const WelcomeEmail = ({
  siteName,
  siteUrl,
  customerName,
}: WelcomeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to {siteName} — let's get you started</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src="https://bpntlyplmitxiaounthf.supabase.co/storage/v1/object/public/email-assets/logo.png" width="44" height="44" alt={siteName} style={logo} />
        <Heading style={h1}>Welcome to {siteName}!</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hello,'} we're glad to have you on board.
        </Text>
        <Text style={text}>
          You can now top up your wallet and start purchasing affordable data bundles for any network in Ghana.
        </Text>
        <Button style={button} href={siteUrl}>
          Go to Dashboard
        </Button>
        <Text style={footer}>
          Need help? Reach out to our support team anytime.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default WelcomeEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 28px' }
const logo = { borderRadius: '12px', marginBottom: '24px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: 'hsl(222, 28%, 12%)', margin: '0 0 16px' }
const text = { fontSize: '14px', color: 'hsl(220, 10%, 46%)', lineHeight: '1.6', margin: '0 0 24px' }
const button = {
  backgroundColor: 'hsl(217, 72%, 50%)',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '12px',
  padding: '12px 24px',
  textDecoration: 'none',
  fontWeight: '500' as const,
}
const footer = { fontSize: '12px', color: 'hsl(220, 10%, 46%)', margin: '30px 0 0' }
