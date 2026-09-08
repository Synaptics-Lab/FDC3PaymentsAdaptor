# FINOS FDC3 2.0 × SynapticChain DPI — IBM Hackathon Entry

> **Production-ready FINOS FDC3 2.0 client adapter and ISO 20022 wire dispatcher connecting institutional desktop trading applications to the SynapticChain Sovereign Digital Public Infrastructure (DPI) gateway.**

[![FINOS FDC3](https://img.shields.io/badge/FINOS-FDC3%202.0-0033a0?logo=finos)](https://fdc3.finos.org)
[![ISO 20022](https://img.shields.io/badge/ISO%2020022-pacs.008.001.08-blue)](https://www.iso20022.org)
[![Conformance Suite](https://img.shields.io/badge/conformance-passing-brightgreen)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-18%2B-brightgreen?logo=node.js)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-success)](package.json)
[![Live Chain](https://img.shields.io/badge/chain-african--alpha--testnet-orange)](https://finos.synapticchain.xyz)


---

## Overview

This project implements:

1. **FINOS FDC3 2.0 Desktop Agent Bridge** — supporting standard channels (`red`, `green`, `blue`, `global`) and the `InitiatePayment` intent with `fdc3.paymentContext` context type.
2. **ISO 20022 CBPR+ `pacs.008.001.08` Message Builder** — fully schema-compliant XML with auto-generated SWIFT UETR (UUIDv4) and canonical Message IDs.
3. **On-Chain Settlement Dispatch (Citi OpenEAGO Phase 3)** — live POST to the SynapticChain L1 SCBFT gateway with confirmed `tx_hash`, block height, and 0.50% TSA statutory deduction.
4. **Automated Self-Verification Suite** — end-to-end proof of connectivity, consensus, reserve vault, XML build, and on-chain settlement.

---

## Live Infrastructure

All endpoints are live on Cloudflare SSL:

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | Chain health, SCBFT consensus, neuron count |
| `GET /api/reserve` | 150M ZMW Central Bank Reserve Vault |
| `GET /api/txs` | Real-time transaction ring |
| `POST /api/send` | Direct settlement wire dispatcher |
| `POST /rpc` | Layer-1 SCBFT JSON-RPC (`syn_getStatus`) |

Base gateway & Cockpit: **https://finos.synapticchain.xyz**

### Interactive Cockpit
Access the institutional dashboard at **https://finos.synapticchain.xyz** to interact with:
- **OpenEAGO Matrix**: Live monitoring of all 6 Citi OpenEAGO lifecycle phases.
- **ISO 20022 Wire Terminal**: Interactive `pacs.008.001.08` XML generator and CBPR+ schema validator.
- **FDC3 Context Bus**: Visual multi-channel listener (`red`, `green`, `blue`, `global`) and intent trigger.
- **Live DPI Settlement Stream**: Real-time SCBFT Layer-1 settlement receipts, block heights, and TSA deductions.
- **Central Bank Reserve**: Live 150M ZMW vault telemetry with cryptographic reserve ratio proofs.


---

## Quick Start

```bash
# Run self-verification suite (zero external dependencies)
npm test

# Or run directly via Node 18+:
node finos_connector.js
```

### Sample Output

```
╔══════════════════════════════════════════════════════════════════════╗
║  FINOS FDC3 2.0 × SynapticChain DPI — Self-Verification Suite       ║
╚══════════════════════════════════════════════════════════════════════╝

Step 1 — Sovereign Chain Health (SCBFT Consensus)
  [✓] SCBFT consensus: 3/3 neurons synced — height 39513 — 129.71 TPS
  [✓] Chain ID: 1 (african-alpha-testnet)
  [✓] Watcher status: healthy

Step 2 — Central Bank Reserve Vault Query
  [✓] Total supply:    150.225M ZMW
  [✓] Reserve vault:   K150,100,000 ZMW
  [✓] Reserve ratio:   99.91%

Step 3 — FDC3 InitiatePayment Intent Emulation
  [✓] FDC3 agent initialised — channels: red, green, blue, global
  [✓] Intent listener registered: InitiatePayment
  [✓] Raising FDC3 intent: InitiatePayment  amount: K100 ZMW

Step 4 — ISO 20022 CBPR+ pacs.008.001.08 Construction
  [✓] UETR (UUIDv4):   f4498b87-497b-4e87-8d0f-b11639c96539
  [✓] Message ID:      SYN-FINOS-20260908-DD40
  [✓] CBPR+ valid:     yes (all required elements present)
  [✓] TSA deduction:   K0.5 (0.50% → Central Bank TSA)

Step 5 — L1 SCBFT On-Chain Settlement Receipt
  [✓] Transaction hash:   78e76699d288fe4ea773492094055f999de48bf4e7297459068f2ed1a57a6227
  [✓] Status:             confirmed
  [✓] Block height:       39513
  [✓] Payee net (ZMW):    K99.5
  [✓] ZRA/TSA tax (ZMW):  K0.5
```

---

## Files

| File | Description |
|---|---|
| [`finos_connector.js`](finos_connector.js) | Standalone Node 18+ runner — self-verification suite + FDC3 daemon mode |
| [`fdc3-openeago-adapter.ts`](fdc3-openeago-adapter.ts) | TypeScript FDC3 Desktop Agent adapter — importable in OpenFin, Symphony, Bloomberg B-PIPE |
| [`package.json`](package.json) | `"type": "module"` — enables native ESM |

---

## TypeScript Adapter Usage

### OpenFin / Symphony / Bloomberg B-PIPE

```ts
import { createSynapticAdapter } from './fdc3-openeago-adapter';

const adapter = await createSynapticAdapter();

// Raise a payment intent end-to-end
const result = await adapter.raiseInitiatePayment({
  amount  : '500',
  payee   : 'syn1...',
  debtor  : { name: 'Trading Desk A', account: 'SYN-DESK-A-001' },
  creditor: { name: 'Counterparty B',  account: 'syn1...' },
});

console.log(result.receipt.tx_hash);    // confirmed on-chain hash
console.log(result.receipt.latency_ms); // network round-trip ms
console.log(result.tsa_deduction);      // 0.50% → Central Bank TSA
console.log(result.xml);               // full pacs.008.001.08 XML
```

### Subscribe to FDC3 Channel

```ts
import { FDC3DesktopAgentBridge } from './fdc3-openeago-adapter';

const agent = new FDC3DesktopAgentBridge();
agent.addContextListener('green', 'fdc3.paymentContext', (ctx) => {
  console.log('Received payment context on green channel:', ctx);
});
```

### Build ISO 20022 XML Standalone

```ts
import { buildPacs008, validatePacs008, generateUETR, generateMsgId } from './fdc3-openeago-adapter';

const uetr  = generateUETR();
const msgId = generateMsgId();
const xml   = buildPacs008(ctx, uetr, msgId);
const { valid, errors } = validatePacs008(xml);
```

---

## FDC3 Daemon Mode

Keep the intent bus running and handle payment intents from connected desktop applications:

```bash
node finos_connector.js --listen
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SYNCHAIN_GATEWAY` | `https://finos.synapticchain.xyz` | Override base gateway URL |
| `LOG_LEVEL` | `info` | `silent` \| `info` \| `debug` |

---

## Architecture

```
Bloomberg / OpenFin / Symphony
          │
          │  FDC3 raiseIntent('InitiatePayment', fdc3.paymentContext)
          ▼
┌─────────────────────────────────┐
│   FDC3DesktopAgentBridge        │  ← fdc3-openeago-adapter.ts
│   channels: red/green/blue/global│
└─────────────┬───────────────────┘
              │
              │  handleInitiatePayment()
              ▼
┌─────────────────────────────────┐
│   ISO 20022 pacs.008.001.08     │
│   UETR + MsgId generation       │
│   CBPR+ XML build + validation  │
└─────────────┬───────────────────┘
              │
              │  POST /api/send
              ▼
┌─────────────────────────────────┐
│   SynapticChain SCBFT L1        │  ← african-alpha-testnet
│   tx_hash + block_height        │
│   0.50% TSA deduction → BOZ     │
└─────────────────────────────────┘
```

---

## IBM Hackathon

Built with **IBM Bob** for the IBM Hackathon.  
Chain: `african-alpha-testnet` · Chain ID: `1` · SCBFT neurons: `3/3`
