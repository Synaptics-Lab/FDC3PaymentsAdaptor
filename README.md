# FDC3 Payments Adaptor

[![Conformance Suite](https://img.shields.io/badge/conformance-passing-10b981)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-success)](package.json)
[![Consensus](https://img.shields.io/badge/consensus-SCBFT%20256--lane-8b5cf6)](https://nodes.synapticchain.xyz)
[![Live Chain](https://img.shields.io/badge/network-african--alpha--testnet-orange)](https://finos.synapticchain.xyz)

---

## Overview

The **FDC3 Payments Adaptor** is a reference implementation for bridging traditional institutional financial desktop workflows (via the FDC3 3.0 standard) to blockchain and DLT settlement networks. 

This repository was submitted for incubation into FINOS-Labs alongside the FDC3 `InitiatePayment` intent and `fdc3.paymentContext` context type (see [FDC3 Proposal #2178](https://github.com/finos/FDC3/issues/2178)).

### Core Capabilities

1. **FINOS FDC3 3.0 Desktop Agent Bridge**: Supports standard channels (`red`, `green`, `blue`, `global`) and fully implements the `InitiatePayment` intent listener using the `fdc3.paymentContext` type.
2. **ISO 20022 CBPR+ `pacs.008.001.08` Engine**: Automatically translates FDC3 JSON context into schema-compliant XML with auto-generated SWIFT UETR (UUIDv4) and canonical Message IDs.
3. **On-Chain Settlement Dispatch**: Executes live settlement to the SynapticChain L1 SCBFT gateway using Universal 5-Rail routing, returning cryptographic receipts (tx_hash, block height) to the FDC3 intent caller.
4. **Automated Self-Verification Suite**: End-to-end proof of connectivity, consensus verification, XML building, and on-chain settlement without requiring external node infrastructure.

---

## Live Infrastructure

All endpoints are live on Cloudflare SSL against the African Alpha testnet:

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | Chain health, SCBFT consensus, neuron count |
| `GET /api/reserve` | Query Central Bank Reserve Vault |
| `POST /api/send` | Direct settlement wire dispatcher (ISO 20022) |
| `POST /rpc` | Layer-1 SCBFT JSON-RPC |

Base gateway & Cockpit: **https://finos.synapticchain.xyz**

---

## Quick Start

```bash
# Run self-verification suite (zero external dependencies)
npm test

# Or run directly via Node:
node finos_connector.js
```

### Sample Output

```
╔══════════════════════════════════════════════════════════════════════╗
║  FINOS FDC3 3.0 × DLT Settlement — Payments Adaptor Suite            ║
╚══════════════════════════════════════════════════════════════════════╝

Step 1 — DLT Sovereign Chain Health (SCBFT Consensus)
  [✓] SCBFT consensus: 3/3 neurons synced — height 39513 — 129.71 TPS
  [✓] Chain ID: 1 (african-alpha-testnet)

Step 2 — FDC3 InitiatePayment Intent Emulation
  [✓] FDC3 agent initialised — channels: red, green, blue, global
  [✓] Intent listener registered: InitiatePayment
  [✓] Raising FDC3 intent: InitiatePayment

Step 3 — ISO 20022 CBPR+ pacs.008.001.08 Construction
  [✓] UETR (UUIDv4):   f4498b87-497b-4e87-8d0f-b11639c96539
  [✓] Message ID:      SYN-FINOS-20260908-DD40
  [✓] CBPR+ valid:     yes (all required elements present)

Step 4 — L1 SCBFT On-Chain Settlement Receipt
  [✓] Transaction hash:   78e76699d288fe4ea773492094055f999de48bf4e7297459068f2ed1a57a6227
  [✓] Status:             confirmed
  [✓] Block height:       39513
```

---

## TypeScript Usage

### OpenFin / Symphony / Bloomberg B-PIPE Integration

```ts
import { createPaymentAdapter } from './fdc3-payments-adapter';

const adapter = await createPaymentAdapter();

// Raise an InitiatePayment intent end-to-end
const result = await adapter.raiseInitiatePayment({
  amount  : '150000.00',
  currency: 'sUSD',
  debtor  : { name: 'Trading Desk A', account: 'syn1qyz7g8v...' },
  creditor: { name: 'Counterparty B', account: 'syn1qqy7x2w...' },
  networkRouting: {
    rail: 'Universal5Rail',
    signatureType: 'CE-WOTS+'
  }
});

console.log(result.receipt.tx_hash);    // confirmed on-chain hash
console.log(result.xml);               // full pacs.008.001.08 XML
```

### Subscribe to FDC3 Channel

```ts
import { FDC3PaymentsAdaptor } from './fdc3-payments-adapter';

const agent = new FDC3PaymentsAdaptor();
agent.addContextListener('green', 'fdc3.paymentContext', (ctx) => {
  console.log('Received institutional payment context on green channel:', ctx);
});
```

---

## Architecture Flow

```
Desktop App (Bloomberg / Symphony / OpenFin)
          │
          │  FDC3 raiseIntent('InitiatePayment', fdc3.paymentContext)
          ▼
┌─────────────────────────────────┐
│   FDC3PaymentsAdaptor           │
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
              │  POST /api/send (L1 Gateway)
              ▼
┌─────────────────────────────────┐
│   DLT Settlement Network        │
│   (e.g., SynapticChain SCBFT)   │
└─────────────────────────────────┘
```
