"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Edit3,
  Check,
  X,
  Play,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";

interface Transaction {
  id: string;
  from: string;
  to: string;
  input: string;
  value: string;
  gas: string;
  gasPrice: string;
  blockNumber: string;
  isEditing: boolean;
  inputType: "function" | "raw";
}

interface BundleState {
  transactions: Transaction[];
  hypeBalanceOverrides: Array<{ key: string; value: string }>;
  stateOverrideContracts: Array<{
    address: string;
    storageOverrides: Array<{ key: string; value: string }>;
  }>;
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function createEmptyTransaction(): Transaction {
  return {
    id: generateId(),
    from: "",
    to: "",
    input: "",
    value: "",
    gas: "800000",
    gasPrice: "0",
    blockNumber: "",
    isEditing: true,
    inputType: "raw",
  };
}

function serializeBundleToQuery(bundleState: BundleState) {
  const qs = new URLSearchParams();

  // Serialize transactions
  qs.set(
    "transactions",
    JSON.stringify(
      bundleState.transactions.map((t) => ({
        ...t,
        isEditing: false, // Don't persist editing state
      }))
    )
  );

  // Serialize state overrides similar to original
  const stateObjects: Record<
    string,
    { balance?: string; stateDiff?: Record<string, string> }
  > = {};
  const ensure0x = (v: string) =>
    v?.startsWith("0x") || v?.startsWith("0X") ? v : `0x${v || "0"}`;

  // balances
  for (const { key, value } of bundleState.hypeBalanceOverrides) {
    const addr = (key || "").trim();
    const bal = (value || "").trim();
    if (!addr || !bal) continue;
    if (!stateObjects[addr]) stateObjects[addr] = {};
    stateObjects[addr].balance = bal;
  }

  // storage
  for (const c of bundleState.stateOverrideContracts) {
    const addr = (c.address || "").trim();
    if (!addr) continue;
    const diff: Record<string, string> = {};
    for (const { key, value } of c.storageOverrides || []) {
      const k = (key || "").trim();
      const v = (value || "").trim();
      if (!k || !v) continue;
      diff[ensure0x(k)] = ensure0x(v);
    }
    if (Object.keys(diff).length) {
      if (!stateObjects[addr]) stateObjects[addr] = {};
      stateObjects[addr].stateDiff = {
        ...(stateObjects[addr].stateDiff || {}),
        ...diff,
      };
    }
  }

  if (Object.keys(stateObjects).length) {
    qs.set("stateOverrides", JSON.stringify(stateObjects));
  }

  return qs.toString();
}

function deserializeBundleFromQuery(
  searchParams: URLSearchParams
): BundleState {
  const defaultState: BundleState = {
    transactions: [],
    hypeBalanceOverrides: [],
    stateOverrideContracts: [],
  };

  try {
    // Deserialize transactions
    const transactionsParam = searchParams.get("transactions");
    if (transactionsParam) {
      const parsedTransactions = JSON.parse(transactionsParam) as Transaction[];
      defaultState.transactions = parsedTransactions.map((t) => ({
        ...t,
        isEditing: false,
      }));
    }

    // Deserialize state overrides
    const so = searchParams.get("stateOverrides");
    if (so) {
      const parsed = JSON.parse(so) as Record<
        string,
        { balance?: string; stateDiff?: Record<string, string> }
      >;

      // balances → hypeBalanceOverrides
      defaultState.hypeBalanceOverrides = Object.entries(parsed)
        .filter(([_, o]) => o.balance)
        .map(([address, o]) => ({ key: address, value: o.balance as string }));

      // stateDiff → stateOverrideContracts
      const stor: Array<{
        address: string;
        storageOverrides: Array<{ key: string; value: string }>;
      }> = [];
      for (const [address, o] of Object.entries(parsed)) {
        if (o.stateDiff && Object.keys(o.stateDiff).length) {
          stor.push({
            address,
            storageOverrides: Object.entries(o.stateDiff).map(([k, v]) => ({
              key: k,
              value: v,
            })),
          });
        }
      }
      defaultState.stateOverrideContracts = stor;
    }
  } catch (error) {
    console.error("Error deserializing bundle state:", error);
  }

  return defaultState;
}

export default function BundleSimulatorPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params?.slug || "bundle-v1";

  const [bundleState, setBundleState] = useState<BundleState>({
    transactions: [],
    hypeBalanceOverrides: [],
    stateOverrideContracts: [],
  });

  const [isLoading, setIsLoading] = useState(false);
  const [currentBlock, setCurrentBlock] = useState<number | null>(null);
  const [globalStateExpanded, setGlobalStateExpanded] = useState(false);

  // Hydrate from URL on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if ([...sp.keys()].length === 0) return;

    const hydratedState = deserializeBundleFromQuery(sp);
    setBundleState(hydratedState);
  }, []);

  // Update URL when state changes
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = serializeBundleToQuery(bundleState);
      const nextSlug = "v1";
      const next = `/dashboard/advanceSimulator/${encodeURIComponent(
        nextSlug
      )}?${qs}`;
      const current = `${window.location.pathname}${window.location.search}`;
      if (next !== current) {
        router.replace(next, { scroll: false });
      }
    }, 350);

    return () => clearTimeout(t);
  }, [bundleState, router]);

  // Fetch current block
  useEffect(() => {
    let cancelled = false;

    async function loadBlock() {
      try {
        const res = await fetch(process.env.NEXT_PUBLIC_RPC_URL as string, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_blockNumber",
            params: [],
            id: 1,
          }),
        });
        const data = await res.json();
        if (!cancelled && data?.result) {
          setCurrentBlock(parseInt(data.result, 16));
        }
      } catch {
        // ignore
      }
    }

    loadBlock();
    const t = setInterval(loadBlock, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const addTransaction = () => {
    setBundleState((prev) => ({
      ...prev,
      transactions: [...prev.transactions, createEmptyTransaction()],
    }));
  };

  const removeTransaction = (id: string) => {
    setBundleState((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((t) => t.id !== id),
    }));
  };

  const updateTransaction = (id: string, updates: Partial<Transaction>) => {
    setBundleState((prev) => ({
      ...prev,
      transactions: prev.transactions.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  };

  const moveTransaction = (id: string, direction: "up" | "down") => {
    setBundleState((prev) => {
      const transactions = [...prev.transactions];
      const index = transactions.findIndex((t) => t.id === id);
      if (index === -1) return prev;

      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= transactions.length) return prev;

      [transactions[index], transactions[newIndex]] = [
        transactions[newIndex],
        transactions[index],
      ];

      return { ...prev, transactions };
    });
  };

  const toggleEditTransaction = (id: string) => {
    updateTransaction(id, {
      isEditing: !bundleState.transactions.find((t) => t.id === id)?.isEditing,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bundleState.transactions.length === 0) {
      alert("Please add at least one transaction to the bundle.");
      return;
    }

    setIsLoading(true);
    try {
      const qs = serializeBundleToQuery(bundleState);
      const slug = "v1";
      router.push(
        `/dashboard/advanceSimulator/${encodeURIComponent(slug)}/view?${qs}`
      );
    } catch (err) {
      console.error(err);
      alert("Could not prepare the bundle simulation URL.");
    } finally {
      setIsLoading(false);
    }
  };

  const truncateAddress = (address: string, startChars = 6, endChars = 4) => {
    if (!address || address.length <= startChars + endChars) return address;
    return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
  };

  const truncateData = (data: string, maxChars = 10) => {
    if (!data || data.length <= maxChars) return data;
    return `${data.slice(0, maxChars)}...`;
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Bundle Transaction</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">
                {bundleState.transactions.length} transaction(s) in bundle
              </span>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Transactions List */}
          <div className="space-y-4">
            {bundleState.transactions.map((transaction, index) => (
              <Card
                key={transaction.id}
                className="border"
                style={{
                  backgroundColor: "rgba(30, 30, 30, 0.6)",
                  borderColor: "var(--border)",
                  backdropFilter: "blur(10px)",
                }}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 bg-[#17BEBB] rounded-full flex items-center justify-center text-xs font-bold">
                      {index + 1}
                    </div>
                    <CardTitle
                      className="text-lg"
                      style={{ color: "var(--text-primary)" }}
                    >
                      Transaction #{index + 1}
                    </CardTitle>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Move up */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => moveTransaction(transaction.id, "up")}
                      disabled={index === 0}
                      className="h-8 w-8 p-0"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>

                    {/* Move down */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => moveTransaction(transaction.id, "down")}
                      disabled={index === bundleState.transactions.length - 1}
                      className="h-8 w-8 p-0"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>

                    {/* Delete */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeTransaction(transaction.id)}
                      className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent>
                  {transaction.isEditing ? (
                    // Edit Mode
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label
                            className="text-secondary mb-2 block"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            From
                          </Label>
                          <Input
                            placeholder="0x..."
                            value={transaction.from}
                            onChange={(e) =>
                              updateTransaction(transaction.id, {
                                from: e.target.value,
                              })
                            }
                            className="border"
                            style={{
                              backgroundColor: "var(--bg-primary)",
                              borderColor: "var(--border)",
                              color: "var(--text-primary)",
                              opacity: 0.8,
                            }}
                            required
                          />
                        </div>

                        <div>
                          <Label
                            className="text-secondary mb-2 block"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            To
                          </Label>
                          <Input
                            placeholder="0x..."
                            value={transaction.to}
                            onChange={(e) =>
                              updateTransaction(transaction.id, {
                                to: e.target.value,
                              })
                            }
                            className="border"
                            style={{
                              backgroundColor: "var(--bg-primary)",
                              borderColor: "var(--border)",
                              color: "var(--text-primary)",
                              opacity: 0.8,
                            }}
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <Label
                          className="text-secondary mb-2 block"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          Input Data
                        </Label>
                        <Textarea
                          placeholder="Enter input data (hex format)"
                          value={transaction.input}
                          onChange={(e) =>
                            updateTransaction(transaction.id, {
                              input: e.target.value,
                            })
                          }
                          className="border"
                          style={{
                            backgroundColor: "var(--bg-primary)",
                            borderColor: "var(--border)",
                            color: "var(--text-primary)",
                            opacity: 0.8,
                            minHeight: "80px",
                          }}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label
                            className="text-secondary mb-2 block"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            Value
                          </Label>
                          <Input
                            placeholder="0"
                            value={transaction.value}
                            onChange={(e) =>
                              updateTransaction(transaction.id, {
                                value: e.target.value,
                              })
                            }
                            className="border"
                            style={{
                              backgroundColor: "var(--bg-primary)",
                              borderColor: "var(--border)",
                              color: "var(--text-primary)",
                              opacity: 0.8,
                            }}
                          />
                        </div>

                        <div>
                          <Label
                            className="text-secondary mb-2 block"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            Gas
                          </Label>
                          <Input
                            placeholder="800000"
                            value={transaction.gas}
                            onChange={(e) =>
                              updateTransaction(transaction.id, {
                                gas: e.target.value,
                              })
                            }
                            className="border"
                            style={{
                              backgroundColor: "var(--bg-primary)",
                              borderColor: "var(--border)",
                              color: "var(--text-primary)",
                              opacity: 0.8,
                            }}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => toggleEditTransaction(transaction.id)}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Confirm Details
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1 flex-1">
                          <div className="text-sm">
                            <span className="text-gray-400">From:</span>
                            <span
                              className="ml-2 font-mono"
                              style={{ color: "var(--text-primary)" }}
                            >
                              {truncateAddress(transaction.from)}
                            </span>
                          </div>
                          <div className="text-sm">
                            <span className="text-gray-400">To:</span>
                            <span
                              className="ml-2 font-mono"
                              style={{ color: "var(--text-primary)" }}
                            >
                              {truncateAddress(transaction.to)}
                            </span>
                          </div>
                          <div className="text-sm">
                            <span className="text-gray-400">Data:</span>
                            <span className="ml-2 font-mono text-blue-400">
                              {truncateData(transaction.input)}
                            </span>
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleEditTransaction(transaction.id)}
                          className="ml-4"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {/* Add Transaction Button */}
            <Button
              type="button"
              variant="outline"
              onClick={addTransaction}
              className="w-full py-6 border-2 border-dashed"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Transaction
            </Button>
          </div>

          {/* Global State Overrides */}
          {bundleState.transactions.length > 0 && (
            <Card
              className="border"
              style={{
                backgroundColor: "rgba(30, 30, 30, 0.6)",
                borderColor: "var(--border)",
                backdropFilter: "blur(10px)",
              }}
            >
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle style={{ color: "var(--text-primary)" }}>
                  Global State Overrides
                </CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setGlobalStateExpanded(!globalStateExpanded)}
                  style={{ color: "var(--text-secondary)" }}
                >
                  {globalStateExpanded ? <ChevronUp /> : <ChevronDown />}
                </Button>
              </CardHeader>
              {globalStateExpanded && (
                <CardContent className="space-y-6">
                  {/* Hype Balance Overrides */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <Label
                        className="text-secondary"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        Balance Overrides
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setBundleState((prev) => ({
                            ...prev,
                            hypeBalanceOverrides: [
                              ...prev.hypeBalanceOverrides,
                              { key: "", value: "" },
                            ],
                          }))
                        }
                        className="h-6"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Balance
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {bundleState.hypeBalanceOverrides.map(
                        (override, index) => (
                          <div
                            key={index}
                            className="flex items-center space-x-2"
                          >
                            <Input
                              placeholder="Address (0x...)"
                              value={override.key}
                              onChange={(e) =>
                                setBundleState((prev) => ({
                                  ...prev,
                                  hypeBalanceOverrides:
                                    prev.hypeBalanceOverrides.map((item, i) =>
                                      i === index
                                        ? { ...item, key: e.target.value }
                                        : item
                                    ),
                                }))
                              }
                              className="border flex-1"
                              style={{
                                backgroundColor: "var(--bg-primary)",
                                borderColor: "var(--border)",
                                color: "var(--text-primary)",
                                opacity: 0.8,
                              }}
                            />
                            <Input
                              placeholder="Balance (wei)"
                              value={override.value}
                              onChange={(e) =>
                                setBundleState((prev) => ({
                                  ...prev,
                                  hypeBalanceOverrides:
                                    prev.hypeBalanceOverrides.map((item, i) =>
                                      i === index
                                        ? { ...item, value: e.target.value }
                                        : item
                                    ),
                                }))
                              }
                              className="border flex-1"
                              style={{
                                backgroundColor: "var(--bg-primary)",
                                borderColor: "var(--border)",
                                color: "var(--text-primary)",
                                opacity: 0.8,
                              }}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setBundleState((prev) => ({
                                  ...prev,
                                  hypeBalanceOverrides:
                                    prev.hypeBalanceOverrides.filter(
                                      (_, i) => i !== index
                                    ),
                                }))
                              }
                              className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                            >
                              ×
                            </Button>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  {/* Storage Overrides */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <Label
                        className="text-secondary"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        Storage Overrides
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setBundleState((prev) => ({
                            ...prev,
                            stateOverrideContracts: [
                              ...prev.stateOverrideContracts,
                              { address: "", storageOverrides: [] },
                            ],
                          }))
                        }
                        className="h-6"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Contract
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {bundleState.stateOverrideContracts.map(
                        (contract, contractIndex) => (
                          <div
                            key={contractIndex}
                            className="border border-gray-600 rounded-lg p-3 space-y-3"
                          >
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-medium text-white">
                                Contract {contractIndex + 1}
                              </h4>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setBundleState((prev) => ({
                                    ...prev,
                                    stateOverrideContracts:
                                      prev.stateOverrideContracts.filter(
                                        (_, i) => i !== contractIndex
                                      ),
                                  }))
                                }
                                className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                              >
                                ×
                              </Button>
                            </div>

                            <Input
                              placeholder="Contract Address (0x...)"
                              value={contract.address}
                              onChange={(e) =>
                                setBundleState((prev) => ({
                                  ...prev,
                                  stateOverrideContracts:
                                    prev.stateOverrideContracts.map((item, i) =>
                                      i === contractIndex
                                        ? { ...item, address: e.target.value }
                                        : item
                                    ),
                                }))
                              }
                              className="border"
                              style={{
                                backgroundColor: "var(--bg-primary)",
                                borderColor: "var(--border)",
                                color: "var(--text-primary)",
                                opacity: 0.8,
                              }}
                            />

                            {contract.storageOverrides.map(
                              (storage, storageIndex) => (
                                <div
                                  key={storageIndex}
                                  className="flex items-center space-x-2 pl-4"
                                >
                                  <Input
                                    placeholder="Storage Key (0x...)"
                                    value={storage.key}
                                    onChange={(e) =>
                                      setBundleState((prev) => ({
                                        ...prev,
                                        stateOverrideContracts:
                                          prev.stateOverrideContracts.map(
                                            (item, i) =>
                                              i === contractIndex
                                                ? {
                                                    ...item,
                                                    storageOverrides:
                                                      item.storageOverrides.map(
                                                        (s, si) =>
                                                          si === storageIndex
                                                            ? {
                                                                ...s,
                                                                key: e.target
                                                                  .value,
                                                              }
                                                            : s
                                                      ),
                                                  }
                                                : item
                                          ),
                                      }))
                                    }
                                    className="border flex-1"
                                    style={{
                                      backgroundColor: "var(--bg-primary)",
                                      borderColor: "var(--border)",
                                      color: "var(--text-primary)",
                                      opacity: 0.8,
                                    }}
                                  />
                                  <Input
                                    placeholder="Storage Value (0x...)"
                                    value={storage.value}
                                    onChange={(e) =>
                                      setBundleState((prev) => ({
                                        ...prev,
                                        stateOverrideContracts:
                                          prev.stateOverrideContracts.map(
                                            (item, i) =>
                                              i === contractIndex
                                                ? {
                                                    ...item,
                                                    storageOverrides:
                                                      item.storageOverrides.map(
                                                        (s, si) =>
                                                          si === storageIndex
                                                            ? {
                                                                ...s,
                                                                value:
                                                                  e.target
                                                                    .value,
                                                              }
                                                            : s
                                                      ),
                                                  }
                                                : item
                                          ),
                                      }))
                                    }
                                    className="border flex-1"
                                    style={{
                                      backgroundColor: "var(--bg-primary)",
                                      borderColor: "var(--border)",
                                      color: "var(--text-primary)",
                                      opacity: 0.8,
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      setBundleState((prev) => ({
                                        ...prev,
                                        stateOverrideContracts:
                                          prev.stateOverrideContracts.map(
                                            (item, i) =>
                                              i === contractIndex
                                                ? {
                                                    ...item,
                                                    storageOverrides:
                                                      item.storageOverrides.filter(
                                                        (_, si) =>
                                                          si !== storageIndex
                                                      ),
                                                  }
                                                : item
                                          ),
                                      }))
                                    }
                                    className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                                  >
                                    ×
                                  </Button>
                                </div>
                              )
                            )}

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setBundleState((prev) => ({
                                  ...prev,
                                  stateOverrideContracts:
                                    prev.stateOverrideContracts.map((item, i) =>
                                      i === contractIndex
                                        ? {
                                            ...item,
                                            storageOverrides: [
                                              ...item.storageOverrides,
                                              { key: "", value: "" },
                                            ],
                                          }
                                        : item
                                    ),
                                }))
                              }
                              className="w-full h-6"
                              style={{
                                borderColor: "var(--border)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              Add Storage Override
                            </Button>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Bundle Simulate Button */}
          <Button
            type="submit"
            className="w-full py-4 text-lg"
            disabled={bundleState.transactions.length === 0 || isLoading}
            style={{
              backgroundColor:
                bundleState.transactions.length > 0
                  ? "var(--btn-primary-bg)"
                  : "var(--text-secondary)",
              color: "var(--btn-primary-text)",
            }}
          >
            {isLoading ? (
              <div className="flex items-center space-x-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Preparing Bundle...</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Play className="h-5 w-5" />
                <span>
                  Simulate Bundle ({bundleState.transactions.length}{" "}
                  transactions)
                </span>
              </div>
            )}
          </Button>

          {/* Info box */}
          {bundleState.transactions.length > 0 && (
            <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <div className="bg-blue-600 rounded-full p-1 mt-1">
                  <svg
                    className="w-4 h-4 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-blue-200">
                    Bundle simulation executes transactions in sequence,
                    allowing you to test complex interactions and MEV
                    strategies. Use atomic mode to ensure all transactions
                    succeed together.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
