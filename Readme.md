<p align="center">
  <img src="./public/logo.png" alt="Illusio" width="200" />
</p>

<h1 align="center">Illusio</h1>

<p align="center">
  An advanced Ethereum transaction simulator and analyzer.<br/>
  Build bundles, override state, inspect traces, and profile gas — all in one sleek UI.
</p>

---

## ✨ What is Illusio?
Illusio lets you construct single transactions or multi-tx bundles, simulate them against a target block, and explore the results with decoded call traces, balance/storage diffs, events, and gas insights — without touching mainnet state.

---

## 🚀 Features by Route

### `/simulator`
- **Single-Tx Simulation**: Enter `from`, `to`, value, gas, gasPrice, and data.
- **Function/Raw Toggle**: Pick a verified contract function + params, or paste raw calldata.
- **State Overrides**: Temporary balances & storage slots for “what-if” scenarios.
- **Decoded Results**: Summary, Contracts, Balance State, Storage State, Events, Gas Profiler.
- **Load Example**: One-click example to see a full end-to-end run.

### `/advanceSimulator`
- **Bundle Builder**: Create **ordered** bundles of multiple transactions.
- **Atomic Mode**: All-or-nothing execution toggle.
- **Per-Tx Access Lists**: Pre-declare touched contracts/storage keys.
- **State Overrides (Global)**: Apply balances/storage overrides used by the whole bundle.
- **Deep Linking**: The entire bundle is encoded in the URL for shareable simulations.
- **View Selector**: Top bar to switch between per-tx results within a bundle.

### `/transactions`
- **Hash Search**: Paste a tx hash to open a detailed decoded view.
- **Re-Simulate**: Quickly re-run a transaction at its original or latest block context.
- **Tabs**: Summary, Contracts, Balance/Storage diff, Events, Gas Profiler.

### `/contracts`
- **ABI Awareness**: Pull verified ABIs (Etherscan) for function selection/encoding.
- **Verification Status**: Inline status for “verified / unverified” contracts.
- **Function Signatures**: Clear display names (`name(type1,type2,...)`).

---

## 🧩 Key Capabilities
- **ABI-Aware Encoding** via function + parameters or raw calldata.
- **Access Lists** to improve simulation accuracy and gas behavior.
- **Trace Decoding** with nested calls and revert reasons.
- **Gas Profiling** to spot the heaviest parts of execution.
- **URL-Driven State** for sharable, reproducible simulations.


