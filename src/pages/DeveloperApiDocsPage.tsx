import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CustomerLayout } from '@/components/CustomerLayout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, BookOpen, Check, Copy, ShieldAlert } from 'lucide-react';
import { API_BASE, DOC_ENDPOINTS, ERROR_ROWS } from '@/lib/developer-api-docs';

function Code({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="rounded-2xl bg-muted p-4 pr-12 text-xs overflow-x-auto whitespace-pre"><code>{code}</code></pre>
      <Button size="icon" variant="ghost" aria-label="Copy code" className="absolute top-2 right-2 h-8 w-8"
        onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-24 space-y-3">
    <h2 className="text-xl font-bold">{title}</h2>
    {children}
  </section>
);

const toc = [
  ['getting-started', 'Getting started'], ['authentication', 'Authentication'], ['endpoints', 'Endpoints'],
  ['purchase-safety', 'Purchase safety'], ['errors', 'Errors'], ['usage-limits', 'Usage reporting limits'],
];

export default function DeveloperApiDocsPage() {
  return (
    <CustomerLayout>
      <div className="max-w-4xl mx-auto space-y-8 pb-10">
        <div className="space-y-2">
          <Link to="/developer-api" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Developer API
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary" /> API documentation</h1>
          <p className="text-sm text-muted-foreground">Connect your own website or app to DATA360 to buy data bundles from your wallet.</p>
        </div>

        <Card className="rounded-[20px] p-4 sm:p-5">
          <p className="text-sm font-semibold mb-2">On this page</p>
          <nav className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-sm">
            {toc.map(([id, label]) => <a key={id} href={`#${id}`} className="text-primary hover:underline">{label}</a>)}
          </nav>
        </Card>

        <Section id="getting-started" title="Getting started">
          <ul className="list-disc pl-5 text-sm space-y-1.5">
            <li><b>Who can use it:</b> any signed-in customer can create a key and check it. Wallet, purchases and usage need active <b>Super Agent</b> access, which DATA360 grants.</li>
            <li><b>Get a key:</b> on the Developer API page, click <i>Generate New API Key</i>. The full key (starting <code>d360_live_</code>) is shown <b>only once</b>. Copy it immediately.</li>
            <li><b>Keep it safe:</b> store it on your server (for example as an environment variable). Never put it in a website's public code, a mobile app, a public repository, or share it with anyone.</li>
            <li><b>If a key leaks:</b> click <i>Revoke</i> next to it on the Developer API page. It stops working immediately. Then create a new one.</li>
          </ul>
          <div className="rounded-2xl bg-destructive/10 p-3 text-sm flex gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            Anyone with your key can spend your wallet balance through the API. Treat it like a password.
          </div>
        </Section>

        <Section id="authentication" title="Authentication">
          <p className="text-sm">Every request needs your key in the <code>Authorization</code> header as a Bearer token.</p>
          <p className="text-sm font-medium">Base URL</p>
          <Code code={API_BASE} />
          <Code code={`Authorization: Bearer YOUR_API_KEY`} />
          <p className="text-sm text-muted-foreground">All responses are JSON and include <code>"success": true</code> or <code>"success": false</code> with an <code>error</code> message.</p>
        </Section>

        <Section id="endpoints" title="Endpoints">
          <div className="space-y-6">
            {DOC_ENDPOINTS.map((e) => (
              <Card key={e.method + e.path} id={e.anchor} className="rounded-[20px] p-4 sm:p-5 space-y-3 scroll-mt-24">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={e.method === 'POST' ? 'default' : 'secondary'}>{e.method}</Badge>
                  <code className="text-sm font-semibold break-all">{e.path}</code>
                </div>
                <p className="text-sm">{e.purpose}</p>
                <p className="text-xs text-muted-foreground"><b>Access:</b> {e.access}</p>
                {e.params && (
                  <div className="text-sm space-y-1">
                    <p className="font-medium">{e.paramsTitle ?? 'Parameters'}</p>
                    <ul className="list-disc pl-5 space-y-1">{e.params.map((p) => <li key={p[0]}><code>{p[0]}</code> — {p[1]}</li>)}</ul>
                  </div>
                )}
                <p className="text-sm font-medium">cURL</p>
                <Code code={e.curl} />
                <p className="text-sm font-medium">JavaScript</p>
                <Code code={e.js} />
                <p className="text-sm font-medium">Example response</p>
                <Code code={e.response} />
                <p className="text-xs text-muted-foreground"><b>Errors:</b> {e.errors}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="purchase-safety" title="Purchase safety">
          <ul className="list-disc pl-5 text-sm space-y-1.5">
            <li>Every <code>POST /v1/purchases</code> must include an <code>Idempotency-Key</code> header: your own unique value of 8–255 characters, such as a UUID.</li>
            <li><b>Retrying?</b> Send the <b>same</b> key and body. If the first attempt went through, you get the original order back (<code>200</code> with <code>"idempotent_replay": true</code>) and you are <b>not charged again</b>.</li>
            <li><b>New purchase?</b> Always use a <b>new</b> key. Reusing a key with a different package, number or reference returns <code>409</code>.</li>
            <li>The server works out the price from your account. You can only send <code>package_id</code>, <code>recipient_phone</code> and an optional <code>client_reference</code>. Any other field (price, customer, provider, status…) is rejected with <code>400</code>.</li>
            <li>Purchases are paid from the wallet of the account the key belongs to, and need active Super Agent access.</li>
            <li>A number that already has an order waiting or in progress can't be ordered again until it finishes (<code>409</code>).</li>
            <li>A <code>201</code> means the order was accepted and paid, not that data has arrived. Use <code>GET /v1/purchases/&#123;id&#125;</code> to follow its status. Delivery depends on the network and isn't guaranteed to be instant.</li>
          </ul>
        </Section>

        <Section id="errors" title="Errors">
          <p className="text-sm">Errors look like this:</p>
          <Code code={`{ "success": false, "error": "Invalid or inactive API key" }`} />
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr><th className="text-left p-2">Status</th><th className="text-left p-2">Message</th><th className="text-left p-2">Meaning</th></tr></thead>
              <tbody>{ERROR_ROWS.map((r) => (
                <tr key={r[0] + r[1]} className="border-t align-top"><td className="p-2 font-mono">{r[0]}</td><td className="p-2">{r[1]}</td><td className="p-2 text-muted-foreground">{r[2]}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Section>

        <Section id="usage-limits" title="Usage reporting limits">
          <ul className="list-disc pl-5 text-sm space-y-1.5">
            <li>Purchases made with your API key are recorded and reported.</li>
            <li>The number of API requests (for example how often you called <code>/v1/packages</code>) is <b>not recorded yet</b>, so it isn't reported.</li>
            <li>Amounts are what you were actually charged at the time of purchase, not today's prices.</li>
            <li>Daily history uses UTC dates, which match Ghana time.</li>
            <li>History covers at most 92 days per request.</li>
          </ul>
        </Section>
      </div>
    </CustomerLayout>
  );
}
