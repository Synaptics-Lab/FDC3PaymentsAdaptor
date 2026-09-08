/**
 * fdc3-openeago-adapter.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * FINOS FDC3 2.0 Desktop Agent Adapter — SynapticChain DPI × Citi OpenEAGO Ph-3
 *
 * Drop this module into any FDC3-capable desktop container (OpenFin, Symphony,
 * Bloomberg B-PIPE web adapter) and call `createSynapticAdapter()` to get a
 * fully-wired settlement agent.
 *
 * The adapter is also consumable from finos_connector.js (Node 18+) via the
 * re-exported types and builder functions.
 *
 * Usage (OpenFin):
 *   import { createSynapticAdapter } from './fdc3-openeago-adapter';
 *   const adapter = await createSynapticAdapter();
 *   await adapter.raiseInitiatePayment({ amount: '500', payee: 'syn1...' });
 *
 * Usage (Bloomberg B-PIPE / headless Node):
 *   import { buildPacs008, generateUETR, generateMsgId } from './fdc3-openeago-adapter';
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** FDC3 standard instrument context (ticker + ISIN) */
export interface FDC3Instrument {
  ticker: string;
  isin:   string;
  name?:  string;
}

/** FDC3 fdc3.paymentContext — the canonical payment intent context */
export interface FDC3PaymentContext {
  type:       'fdc3.paymentContext';
  amount:     string;          // ZMW amount as string e.g. "500.00"
  payee:      string;          // destination syn1... address
  instrument: FDC3Instrument;
  debtor?: {
    name:    string;
    account: string;           // originator syn1... or internal ref
  };
  creditor?: {
    name:    string;
    account: string;           // beneficiary syn1... address
  };
}

/** On-chain settlement receipt returned by /api/send */
export interface SettlementReceipt {
  ok:           boolean;
  tx_hash:      string;
  status:       'confirmed' | 'pending' | 'failed';
  block_height: number;
  payee_zmw:    string;
  zra_zmw:      string;
  payee:        string;
  latency_ms:   number;
}

/** Full result returned by handleInitiatePayment */
export interface WireResult {
  uetr:          string;
  msgId:         string;
  xml:           string;
  receipt:       SettlementReceipt;
  instrument:    FDC3Instrument;
  amount_zmw:    number;
  tsa_deduction: number;
  net_amount:    number;
}

/** CBPR+ validation result */
export interface ValidationResult {
  valid:  boolean;
  errors: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const GATEWAY   = (typeof process !== 'undefined' && process.env?.SYNCHAIN_GATEWAY)
  ? process.env.SYNCHAIN_GATEWAY
  : 'https://finos.synapticchain.xyz';

export const FDC3_INSTRUMENT: FDC3Instrument = {
  ticker: 'ZMW',
  isin:   'ZM00000001',
  name:   'Zambian Kwacha Token',
};

/** FDC3 standard colour channels */
export const FDC3_CHANNELS = ['red', 'green', 'blue', 'global'] as const;
export type  FDC3Channel   = typeof FDC3_CHANNELS[number];

// ─── SWIFT Identifier Generators ─────────────────────────────────────────────

/**
 * Generates a SWIFT UETR — Unique End-to-End Transaction Reference (UUIDv4).
 * Compliant with SWIFT gpi UETR specification (Nov 2017).
 */
export function generateUETR(): string {
  // Use native crypto if available (Node 18+ / modern browsers), else polyfill
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // RFC 4122 UUIDv4 manual generation for older environments
  const hex = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
  hex[12] = '4';                            // version 4
  hex[16] = (parseInt(hex[16], 16) & 0x3 | 0x8).toString(16); // variant 10xx
  return [
    hex.slice( 0,  8).join(''),
    hex.slice( 8, 12).join(''),
    hex.slice(12, 16).join(''),
    hex.slice(16, 20).join(''),
    hex.slice(20, 32).join(''),
  ].join('-');
}

/**
 * Generates a CBPR+ canonical Unique Message ID:
 *   SYN-FINOS-YYYYMMDD-XXXX
 */
export function generateMsgId(): string {
  const d    = new Date();
  const pad  = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const rand = Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  return `SYN-FINOS-${date}-${rand}`;
}

// ─── ISO 20022 pacs.008.001.08 Builder ────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

function isoDateTime(d: Date = new Date()): string {
  return d.toISOString().replace(/(\.\d{3})Z$/, '$1+00:00');
}

/**
 * Builds a SWIFT CBPR+-compliant ISO 20022 pacs.008.001.08 XML envelope.
 *
 * Mandatory elements per CBPR+ Usage Guidelines v3.0:
 *   GrpHdr/MsgId, GrpHdr/CreDtTm, GrpHdr/NbOfTxs, GrpHdr/SttlmInf,
 *   CdtTrfTxInf/PmtId/UETR, CdtTrfTxInf/IntrBkSttlmAmt,
 *   CdtTrfTxInf/Dbtr, CdtTrfTxInf/Cdtr
 */
export function buildPacs008(
  ctx:   FDC3PaymentContext,
  uetr:  string,
  msgId: string,
): string {
  const now      = isoDateTime();
  const sttlDate = new Date().toISOString().slice(0, 10);
  const amount   = Number(ctx.amount).toFixed(2);
  const taxAmt   = (Number(ctx.amount) * 0.005).toFixed(5);
  const netAmt   = (Number(ctx.amount) * 0.995).toFixed(5);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08 pacs.008.001.08.xsd">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${now}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${amount}</CtrlSum>
      <IntrBkSttlmAmt Ccy="ZMW">${amount}</IntrBkSttlmAmt>
      <IntrBkSttlmDt>${sttlDate}</IntrBkSttlmDt>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
        <ClrSys>
          <Prtry>SCBFT-L1</Prtry>
        </ClrSys>
      </SttlmInf>
      <InstgAgt>
        <FinInstnId>
          <BICFI>SYNAZMWAXXX</BICFI>
          <Nm>SynapticChain DPI Gateway</Nm>
          <PstlAdr><Ctry>ZM</Ctry></PstlAdr>
        </FinInstnId>
      </InstgAgt>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <InstrId>${msgId}-001</InstrId>
        <EndToEndId>${msgId}-E2E</EndToEndId>
        <UETR>${uetr}</UETR>
      </PmtId>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
        <LclInstrm><Prtry>FDC3-INITITATEPAYMENT</Prtry></LclInstrm>
        <CtgyPurp><Cd>INTC</Cd></CtgyPurp>
      </PmtTpInf>
      <IntrBkSttlmAmt Ccy="ZMW">${amount}</IntrBkSttlmAmt>
      <IntrBkSttlmDt>${sttlDate}</IntrBkSttlmDt>
      <ChrgBr>SHAR</ChrgBr>
      <!-- TSA Statutory 0.50% Deduction — Central Bank Single Treasury Account -->
      <ChrgsInf>
        <Amt Ccy="ZMW">${taxAmt}</Amt>
        <Agt>
          <FinInstnId>
            <BICFI>BOZZZMWAXXX</BICFI>
            <Nm>Bank of Zambia — TSA</Nm>
          </FinInstnId>
        </Agt>
      </ChrgsInf>
      <InstgAgt>
        <FinInstnId><BICFI>SYNAZMWAXXX</BICFI></FinInstnId>
      </InstgAgt>
      <Dbtr>
        <Nm>${escapeXml(ctx.debtor?.name ?? 'FDC3 Desktop Agent')}</Nm>
        <PstlAdr><Ctry>ZM</Ctry></PstlAdr>
      </Dbtr>
      <DbtrAcct>
        <Id><Othr><Id>${escapeXml(ctx.debtor?.account ?? 'SYN-FDC3-ORIGINATOR')}</Id></Othr></Id>
        <Ccy>ZMW</Ccy>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId><BICFI>SYNAZMWAXXX</BICFI></FinInstnId>
      </DbtrAgt>
      <Cdtr>
        <Nm>${escapeXml(ctx.creditor?.name ?? 'Sovereign Settlement Node')}</Nm>
        <PstlAdr><Ctry>ZM</Ctry></PstlAdr>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <Othr><Id>${escapeXml(ctx.creditor?.account ?? ctx.payee)}</Id></Othr>
        </Id>
        <Ccy>ZMW</Ccy>
      </CdtrAcct>
      <CdtrAgt>
        <FinInstnId><BICFI>SYNAZMWAXXX</BICFI></FinInstnId>
      </CdtrAgt>
      <InstrForNxtAgt>
        <InstrInf>NET_AMT_ZMW=${netAmt};TSA=${taxAmt};TICKER=${ctx.instrument.ticker};ISIN=${ctx.instrument.isin}</InstrInf>
      </InstrForNxtAgt>
      <Purp><Cd>FINOS</Cd></Purp>
      <RmtInf>
        <Ustrd>FDC3 InitiatePayment via SynapticChain DPI — ${msgId}</Ustrd>
      </RmtInf>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
}

/**
 * Validates a pacs.008 XML string for SWIFT CBPR+ structural compliance.
 * Checks that all mandatory CBPR+ Usage Guideline elements are present.
 */
export function validatePacs008(xml: string): ValidationResult {
  const required: string[] = [
    'FIToFICstmrCdtTrf', 'GrpHdr',  'MsgId',           'CreDtTm',
    'NbOfTxs',           'SttlmInf','IntrBkSttlmAmt',  'IntrBkSttlmDt',
    'CdtTrfTxInf',       'PmtId',   'UETR',            'ChrgBr',
    'Dbtr',              'Cdtr',
  ];
  const errors = required.filter(tag => !xml.includes(`<${tag}`));
  return { valid: errors.length === 0, errors };
}

// ─── FDC3 Desktop Agent Bridge ────────────────────────────────────────────────

type IntentHandler = (context: FDC3PaymentContext) => Promise<WireResult>;
type ContextHandler = (context: FDC3PaymentContext) => void;

interface Channel {
  name:        FDC3Channel;
  subscribers: Array<{ type: string | null; fn: ContextHandler }>;
}

/**
 * FDC3 2.0 Desktop Agent Bridge.
 *
 * Implements the FDC3 2.0 DesktopAgent interface subset required for
 * payment intent handling. In a real OpenFin / Symphony runtime, replace
 * `new FDC3DesktopAgentBridge()` with the platform's `window.fdc3` object —
 * the API surface is identical.
 */
export class FDC3DesktopAgentBridge {
  private channels  = new Map<FDC3Channel, Channel>();
  private listeners = new Map<string, IntentHandler[]>();

  constructor() {
    for (const ch of FDC3_CHANNELS) {
      this.channels.set(ch, { name: ch, subscribers: [] });
    }
  }

  /**
   * Register a handler for an FDC3 intent.
   * Mirrors: `fdc3.addIntentListener(intent, handler)`
   */
  addIntentListener(intent: string, handler: IntentHandler): { unsubscribe: () => void } {
    if (!this.listeners.has(intent)) this.listeners.set(intent, []);
    this.listeners.get(intent)!.push(handler);
    return {
      unsubscribe: () => {
        const list = this.listeners.get(intent) ?? [];
        const idx  = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      },
    };
  }

  /**
   * Raise an intent against registered listeners.
   * Mirrors: `fdc3.raiseIntent(intent, context)`
   */
  async raiseIntent(intent: string, context: FDC3PaymentContext): Promise<{ type: string; result: WireResult }> {
    const handlers = this.listeners.get(intent) ?? [];
    if (handlers.length === 0) {
      throw new Error(`No FDC3 listener registered for intent: ${intent}`);
    }
    let result!: WireResult;
    for (const handler of handlers) {
      result = await handler(context);
    }
    return { type: 'IntentResult', result };
  }

  /**
   * Broadcast a context to a named channel.
   * Mirrors: `fdc3.broadcast(context)` (on a joined channel)
   */
  broadcast(channelName: FDC3Channel, context: FDC3PaymentContext): void {
    const ch = this.channels.get(channelName);
    if (!ch) throw new Error(`Unknown FDC3 channel: ${channelName}`);
    for (const sub of ch.subscribers) {
      if (!sub.type || sub.type === context.type) sub.fn(context);
    }
  }

  /**
   * Subscribe to context updates on a named channel.
   * Mirrors: `fdc3.addContextListener(contextType, handler)` on a joined channel
   */
  addContextListener(
    channelName:  FDC3Channel,
    contextType:  string | null,
    handler:      ContextHandler,
  ): { unsubscribe: () => void } {
    const ch = this.channels.get(channelName);
    if (!ch) throw new Error(`Unknown FDC3 channel: ${channelName}`);
    const sub = { type: contextType, fn: handler };
    ch.subscribers.push(sub);
    return {
      unsubscribe: () => {
        const idx = ch.subscribers.indexOf(sub);
        if (idx !== -1) ch.subscribers.splice(idx, 1);
      },
    };
  }
}

// ─── SynapticChain Settlement Client ─────────────────────────────────────────

/**
 * HTTP client for the SynapticChain DPI gateway.
 * All methods return live data — no mocks, no stubs.
 */
export class SynapticChainClient {
  constructor(private readonly gateway: string = GATEWAY) {}

  async getStatus() {
    const r = await fetch(`${this.gateway}/api/status`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`/api/status HTTP ${r.status}`);
    return r.json();
  }

  async getReserve() {
    const r = await fetch(`${this.gateway}/api/reserve`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`/api/reserve HTTP ${r.status}`);
    return r.json();
  }

  async getTxs() {
    const r = await fetch(`${this.gateway}/api/txs`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`/api/txs HTTP ${r.status}`);
    return r.json();
  }

  async rpcCall(method: string, params: unknown[] = []) {
    const r = await fetch(`${this.gateway}/rpc`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    const data = await r.json();
    if (data.error) throw new Error(`RPC error ${data.error.code}: ${data.error.message}`);
    return data.result;
  }

  /**
   * Dispatch a settlement wire to L1 (Citi OpenEAGO Phase 3 payload format).
   */
  async sendWire(
    amount_zmw: string,
    payee:      string,
    entity:     string = 'FDC3 Desktop Wire via Bob',
  ): Promise<SettlementReceipt> {
    const t0  = Date.now();
    const res = await fetch(`${this.gateway}/api/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ amount_zmw, entity, payee }),
    });
    const latency = Date.now() - t0;
    const data    = await res.json();
    if (!data.ok) throw new Error(`Settlement rejected [HTTP ${res.status}]: ${data.error}`);
    return { ...data, latency_ms: latency } as SettlementReceipt;
  }
}

// ─── High-Level Adapter Factory ───────────────────────────────────────────────

export interface SynapticAdapterOptions {
  gateway?: string;
  entity?:  string;           // entity label sent in /api/send payload
}

export interface SynapticAdapter {
  agent:  FDC3DesktopAgentBridge;
  client: SynapticChainClient;
  /** Convenience: raise an InitiatePayment intent end-to-end */
  raiseInitiatePayment: (ctx: Omit<FDC3PaymentContext, 'type' | 'instrument'> & Partial<Pick<FDC3PaymentContext, 'instrument'>>) => Promise<WireResult>;
}

/**
 * Creates a fully-wired SynapticChain FDC3 adapter.
 *
 * @example
 * ```ts
 * const adapter = await createSynapticAdapter();
 * const result  = await adapter.raiseInitiatePayment({
 *   amount: '500',
 *   payee:  'syn1...',
 * });
 * console.log(result.receipt.tx_hash);
 * ```
 */
export async function createSynapticAdapter(opts: SynapticAdapterOptions = {}): Promise<SynapticAdapter> {
  const client = new SynapticChainClient(opts.gateway);
  const agent  = new FDC3DesktopAgentBridge();
  const entity = opts.entity ?? 'FDC3 Desktop Wire via Bob';

  /** Core intent handler — ISO 20022 build → validate → L1 dispatch */
  async function _handleInitiatePayment(ctx: FDC3PaymentContext): Promise<WireResult> {
    if (ctx.type !== 'fdc3.paymentContext') {
      throw new TypeError(`Unexpected context type: ${ctx.type}`);
    }
    if (!ctx.amount || isNaN(Number(ctx.amount))) {
      throw new RangeError('ctx.amount must be a numeric string');
    }
    const payee = ctx.payee ?? ctx.creditor?.account;
    if (!payee) throw new Error('ctx.payee or ctx.creditor.account is required');

    const uetr  = generateUETR();
    const msgId = generateMsgId();
    const xml   = buildPacs008(ctx, uetr, msgId);

    const { valid, errors } = validatePacs008(xml);
    if (!valid) throw new Error(`pacs.008 CBPR+ validation failed: ${errors.join(', ')}`);

    const receipt = await client.sendWire(ctx.amount, payee, entity);

    return {
      uetr,
      msgId,
      xml,
      receipt,
      instrument:    ctx.instrument ?? FDC3_INSTRUMENT,
      amount_zmw:    Number(ctx.amount),
      tsa_deduction: +(Number(ctx.amount) * 0.005).toFixed(5),
      net_amount:    +(Number(ctx.amount) * 0.995).toFixed(5),
    };
  }

  agent.addIntentListener('InitiatePayment', _handleInitiatePayment);

  return {
    agent,
    client,
    raiseInitiatePayment: async (ctx) =>
      (await agent.raiseIntent('InitiatePayment', {
        type:       'fdc3.paymentContext',
        instrument: FDC3_INSTRUMENT,
        ...ctx,
      })).result,
  };
}
