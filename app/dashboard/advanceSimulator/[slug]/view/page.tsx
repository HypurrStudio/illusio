"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import SummaryTab from "../../../simulator/[slug]/view/components/SummaryTab";
import ContractsTab from "../../../simulator/[slug]/view/components/ContractsTab";
import BalanceStateTab from "../../../simulator/[slug]/view/components/BalanceStateTab";
import GasProfileTab from "../../../simulator/[slug]/view/components/GasProfileTab";
import StorageStateTab from "../../../simulator/[slug]/view/components/StorageStateTab";
import TransactionDetails from "../../../simulator/[slug]/view/components/TransactionDetails";
import EventsTab from "../../../simulator/[slug]/view/components/EventsTab";
import { RotateCcw } from "lucide-react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;

/* ----------------------------- helpers --------------------------------- */

const ensure0x = (v?: string) =>
  v && (v.startsWith("0x") || v.startsWith("0X")) ? v : `0x${v ?? "0"}`;

const toHex = (value?: string): string => {
  const s = (value || "").trim();
  if (!s) return "0x0";
  if (s.startsWith("0x") || s.startsWith("0X")) return s;
  try {
    const bi = BigInt(s);
    return "0x" + bi.toString(16);
  } catch {
    const n = Number(s);
    if (!Number.isFinite(n)) return "0x0";
    return "0x" + Math.trunc(n).toString(16);
  }
};

const parseStateOverrides = (sp: URLSearchParams) => {
  const raw = sp.get("stateOverrides");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      { balance?: string; stateDiff?: Record<string, string> }
    >;

    const normalized: Record<
      string,
      { balance?: string; stateDiff?: Record<string, string> }
    > = {};
    for (const [addr, obj] of Object.entries(parsed)) {
      normalized[addr] = {
        balance: obj.balance ? toHex(obj.balance) : undefined,
        stateDiff: obj.stateDiff
          ? Object.fromEntries(
              Object.entries(obj.stateDiff).map(([k, v]) => [
                ensure0x(k),
                toHex(v),
              ])
            )
          : undefined,
      };
    }
    return normalized;
  } catch {
    return {};
  }
};

type BundleTx = {
  from: string;
  to: string;
  input: string;
  value: string;
  gas: string;
  gasPrice: string;
  accessList?: Array<{ address: string; storageKeys: string[] }>;
};

const parseBundleTransactions = (sp: URLSearchParams): BundleTx[] => {
  const raw = sp.get("transactions");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as any[];
    return (arr || []).map((t) => ({
      from: t.from || "",
      to: t.to || "",
      input: t.input ? ensure0x(t.input) : "0x",
      value: toHex(t.value || "0"),
      gas: toHex(t.gas || "0"),
      gasPrice: toHex(t.gasPrice || "0"),
      accessList: Array.isArray(t.accessList)
        ? t.accessList.map((al: any) => ({
            address: al.address || "",
            storageKeys: Array.isArray(al.storageKeys)
              ? al.storageKeys.map((k: string) => ensure0x(k))
              : [],
          }))
        : [],
    }));
  } catch {
    return [];
  }
};

/* ----------------------------- component -------------------------------- */

export default function BundleSimulatorViewPage() {
  const [bundleResults, setBundleResults] = useState<any[] | null>(null); // array of per-tx results
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeTab, setActiveTab] = useState("summary");
  const [expandedStorageSections, setExpandedStorageSections] = useState<
    Set<string>
  >(new Set());
  const [decodedTraceTree, setDecodedTraceTree] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // fetch bundle simulation
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const sp = new URLSearchParams(window.location.search);

        const mode =
          sp.get("atomic") && sp.get("atomic") === "false"
            ? "parallel"
            : "atomic";

        const transactions = parseBundleTransactions(sp);
        const stateObjects = parseStateOverrides(sp);
        const blockNumber = sp.get("block") ? toHex(sp.get("block")!) : "latest";

        const body = {
          mode,
          transactions,
          stateObjects,
          generateAccessList: true,
          blockNumber,
        };
        console.log("Simulate bundle with:", JSON.stringify(body));

        const res = await fetch(`${BACKEND}/api/bundle/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (cancelled) return;
        if (!Array.isArray(data?.results)) {
          throw new Error("Malformed response: missing results[]");
        }

        setBundleResults(data.results);

        // cache contracts merged across results
        const mergedContracts: Record<string, any> = {};
        data.results.forEach((r: any) => {
          if (r.contracts) {
            Object.assign(mergedContracts, r.contracts);
          }
        });
        if (Object.keys(mergedContracts).length) {
          const existing = JSON.parse(
            localStorage.getItem("contractsStorage") || "{}"
          );
          localStorage.setItem(
            "contractsStorage",
            JSON.stringify({ ...existing, ...mergedContracts })
          );
        }
      } catch (e: any) {
        console.error("Failed to load bundle simulation:", e);
        if (!cancelled) {
          setError(e?.message || "Failed to load simulation");
          setBundleResults(null);
          setDecodedTraceTree(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // decode trace for selected result
  useEffect(() => {
    let cancelled = false;

    const decode = async () => {
      try {
        if (!bundleResults || !bundleResults[selectedIdx]) {
          setDecodedTraceTree(null);
          return;
        }

        const current = bundleResults[selectedIdx];
        const { transaction, contracts } = current || {};
        if (!transaction?.callTrace?.[0]) {
          setDecodedTraceTree(null);
          return;
        }

        const { TraceDecoderManual } = await import("@/utils/decodeCallTrace");

        const contractsMap: Record<string, any> = {};
        if (contracts) {
          Object.entries(contracts).forEach(
            ([addr, contract]: [string, any]) => {
              contractsMap[addr] = {
                address: addr,
                ABI: contract.ABI,
                Implementation: contract.Implementation,
                Proxy: contract.Proxy || (contract.Implementation ? "1" : "0"),
              };
            }
          );
        }

        const manual = new TraceDecoderManual(contractsMap);

        const convertCallTrace = (trace: any): any => ({
          from: trace.from || "",
          to: trace.to || "",
          input: trace.input || "0x",
          output: trace.output || "0x",
          gas: trace.gas,
          gasUsed: trace.gasUsed ?? trace.gas_used,
          error: trace.error || "",
          revertReason: trace.revertReason || "",
          value: trace.value,
          type: trace.type,
          calls: Array.isArray(trace.calls)
            ? trace.calls.map(convertCallTrace)
            : undefined,
        });

        const rawRoot = convertCallTrace(transaction.callTrace[0]);
        const decoded = await manual.decodeTrace(rawRoot);
        if (!cancelled) setDecodedTraceTree(decoded);
      } catch (e) {
        console.error("Trace decode error:", e);
        if (!cancelled) setDecodedTraceTree(null);
      }
    };

    decode();
    return () => {
      cancelled = true;
    };
  }, [bundleResults, selectedIdx]);

    // currently selected per-tx result, shaped like single-sim output
    const currentResult = useMemo(() => {
        if (bundleResults && bundleResults[selectedIdx]) {
        const r = bundleResults[selectedIdx];
        // keep same shape used by single simulator components
        return r;
        }
      }, [bundleResults, selectedIdx]);
    


  /* ---------------------------- UI states -------------------------------- */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
          <div className="text-white">Loading simulation data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">⚠️ Error</div>
          <div className="text-white mb-4">{error}</div>
          <Button
            onClick={() =>
              (window.location.href = "/dashboard/advanceSimulator/v1")
            }
            className="bg-blue-600 hover:bg-blue-700"
          >
            Go back
          </Button>
        </div>
      </div>
    );
  }

  if (!bundleResults || bundleResults.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-yellow-400 text-xl mb-4">⚠️ No Data</div>
          <div className="text-white">No simulation results available</div>
          <Button
            onClick={() =>
              (window.location.href = "/dashboard/advanceSimulator/v1")
            }
            className="bg-blue-600 hover:bg-blue-700 mt-4"
          >
            Run Bundle Simulation
          </Button>
        </div>
      </div>
    );
  }


  const tabs = [
    { id: "summary", label: "Summary" },
    { id: "contracts", label: "Contracts" },
    { id: "balance", label: "Balance state" },
    { id: "storage", label: "Storage state" },
    { id: "events", label: "Events" },
    { id: "gas-profiler", label: "Gas Profiler" },
  ];

  const toggleStorageSection = (address: string) => {
    setExpandedStorageSections((prev) => {
      const s = new Set(prev);
      s.has(address) ? s.delete(address) : s.add(address);
      return s;
    });
  };

  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h1 className="text-2xl font-bold text-white">Bundle Simulation</h1>
          <span className="text-sm text-gray-400">
            {bundleResults.length} transaction{bundleResults.length > 1 ? "s" : ""}
          </span>
        </div>

        <Button
          className="border-0 px-4 py-2 rounded-xl font-semibold transition-colors flex items-center space-x-2"
          style={{
            backgroundColor: "var(--btn-primary-bg)",
            color: "var(--btn-primary-text)",
          }}
          onClick={() => {
            // remove /view to re-hit same route and re-run
            const url = window.location.href.replace("/view?", "?");
            window.location.href = url;
          }}
        >
          <RotateCcw className="h-4 w-4" />
          <span>Re-simulate</span>
        </Button>
      </div>

      {/* Top bar: per-transaction selector */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {bundleResults.map((_: any, idx: number) => {
            const active = idx === selectedIdx;
            return (
              <button
                key={idx}
                onClick={() => setSelectedIdx(idx)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  active
                    ? "text-white"
                    : "text-gray-300 hover:text-white hover:border-gray-400"
                }`}
                style={{
                  borderColor: active ? "var(--color-primary)" : "var(--border)",
                  backgroundColor: active ? "rgba(23,190,187,0.15)" : "transparent",
                }}
                aria-label={`Select Transaction ${idx + 1}`}
              >
                Tx {idx + 1}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-gray-400">
          Viewing <span className="text-white">Tx {selectedIdx + 1}</span> of{" "}
          {bundleResults.length}
        </div>
      </div>

      {/* Per-transaction details (re-using existing components) */}
      <TransactionDetails
        responseData={currentResult}
        decodedTraceTree={decodedTraceTree}
      />

      {/* Tabs */}
      <div className="space-y-4">
        <div
          className="flex space-x-1 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as string)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative ${
                activeTab === tab.id
                  ? "text-white border-b-2"
                  : "text-gray-400 hover:text-gray-300"
              }`}
              style={{
                borderColor:
                  activeTab === tab.id ? "var(--color-primary)" : "transparent",
              }}
            >
              <div className="flex items-center space-x-2">
                <span>{tab.label}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Active Tab Content for selected tx */}
        {activeTab === "summary" && (
          <SummaryTab
            activeTab={activeTab}
            responseData={currentResult}
            decodedTraceTree={decodedTraceTree}
          />
        )}
        {activeTab !== "summary" && (
          <div className="mt-6">
            {activeTab === "balance" ? (
              <BalanceStateTab responseData={currentResult} />
            ) : activeTab === "storage" ? (
              <StorageStateTab
                responseData={currentResult}
                toggleStorageSection={toggleStorageSection}
                expandedStorageSections={expandedStorageSections}
              />
            ) : activeTab === "contracts" ? (
              <ContractsTab responseData={currentResult} />
            ) : activeTab === "gas-profiler" ? (
              <GasProfileTab
                responseData={currentResult}
                decodedTraceTree={decodedTraceTree}
              />
            ) : activeTab === "events" ? (
              <EventsTab responseData={currentResult} />
            ) : (
              <p className="text-gray-400 text-center">
                Content for {tabs.find((t) => t.id === activeTab)?.label} tab
                will appear here
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
