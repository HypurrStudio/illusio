"use client";

import { useRef, useState, useEffect } from "react";
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
  Play,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Interface } from "ethers";
import { Switch } from "@headlessui/react";
import ReactSwitch from "react-switch";

// ---------- Types ----------
interface ContractABI {
  functions: EtherscanFunction[];
}

interface EtherscanFunction {
  name: string;
  inputs: Array<{ name: string; type: string }>;
}

interface Transaction {
  id: string;
  from: string;
  to: string;
  input: string;
  value: string;
  gas: string;
  gasPrice: string;
  isEditing: boolean;
  inputType: "function" | "raw";
  // ABI-related per tx
  isLoadingABI?: boolean;
  isVerifiedABI?: boolean | null;
  contractABI: ContractABI | null;
  selectedFunction: EtherscanFunction | null;
  functionParameters: Array<{ name: string; type: string; value: string }>;
  accessList: Array<{ address: string; storageKeys: string[] }>;
}

interface BundleState {
  blockNumber: string;
  isAtomic: boolean;
  transactions: Transaction[];
  hypeBalanceOverrides: Array<{ key: string; value: string }>;
  stateOverrideContracts: Array<{
    address: string;
    storageOverrides: Array<{ key: string; value: string }>;
  }>;
}

// ---------- Helpers ----------
const ETHERSCAN_API = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY;

const fetchContractABI = async (
  address: string
): Promise<ContractABI | null> => {
  try {
    const res = await fetch(
      `https://api.etherscan.io/v2/api?chainid=999&module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API}`
    );
    const data = await res.json();
    if (data.status !== "1") return null;

    const parsed = JSON.parse(data.result);
    const functions = parsed
      .filter((item: any) => item.type === "function")
      .map((func: any) => ({
        name: func.name,
        inputs: (func.inputs || []).map((i: any) => ({
          name: i.name,
          type: i.type,
        })),
      }));

    return { functions };
  } catch (err) {
    console.error("Failed to fetch ABI:", err);
    return null;
  }
};

const getFunctionDisplayName = (func: EtherscanFunction): string => {
  return `${func.name}(${func.inputs.map((i) => i.type).join(",")})`;
};

const encodeFunctionCall = (
  functionName: string,
  parameters: Array<{ name: string; type: string; value: string }>,
  abi: ContractABI
): string => {
  try {
    const full = abi.functions.find((f) => f.name === functionName);
    if (!full) return "0x";
    // Use full function signature to avoid overload ambiguity
    const signature = `${full.name}(${full.inputs
      .map((i) => i.type)
      .join(",")})`;
    const iface = new Interface([`function ${signature}`]);
    const values = parameters.map((p) => p.value);
    return iface.encodeFunctionData(signature, values);
  } catch (err) {
    console.error("Error encoding function call:", err);
    return "0x";
  }
};

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function createEmptyTransaction(): Transaction {
  return {
    id: generateId(),
    from: "",
    to: "",
    input: "",
    value: "0",
    gas: "800000",
    gasPrice: "0",
    isEditing: true,
    inputType: "raw",
    isLoadingABI: false,
    isVerifiedABI: null,
    contractABI: null,
    selectedFunction: null,
    functionParameters: [],
    accessList: [],
  };
}

function serializeBundleToQuery(bundleState: BundleState) {
  const qs = new URLSearchParams();

  // Basic
  if (bundleState.blockNumber) qs.set("block", bundleState.blockNumber);
  qs.set("atomic", bundleState.isAtomic.toString());

  // Transactions — strip non-serializable / UI-only fields
  qs.set(
    "transactions",
    JSON.stringify(
      bundleState.transactions.map((t) => {
        const {
          isEditing,
          contractABI,
          isLoadingABI,
          isVerifiedABI,
          // keep the rest
          ...rest
        } = t;
        return rest;
      })
    )
  );

  // State overrides
  const stateObjects: Record<
    string,
    { balance?: string; stateDiff?: Record<string, string> }
  > = {};
  const ensure0x = (v: string) =>
    v?.startsWith("0x") || v?.startsWith("0X") ? v : `0x${v || "0"}`;

  for (const { key, value } of bundleState.hypeBalanceOverrides) {
    const addr = (key || "").trim();
    const bal = (value || "").trim();
    if (!addr || !bal) continue;
    if (!stateObjects[addr]) stateObjects[addr] = {};
    stateObjects[addr].balance = bal;
  }

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
    blockNumber: "",
    isAtomic: true,
    transactions: [],
    hypeBalanceOverrides: [],
    stateOverrideContracts: [],
  };

  try {
    // Basic
    defaultState.blockNumber = searchParams.get("block") || "";
    const atomicParam = searchParams.get("atomic");
    if (atomicParam) defaultState.isAtomic = atomicParam === "true";

    // Transactions
    const transactionsParam = searchParams.get("transactions");
    if (transactionsParam) {
      const parsed = JSON.parse(transactionsParam) as Transaction[];
      defaultState.transactions = parsed.map((t) => ({
        ...t,
        isEditing: false,
        isLoadingABI: false,
        isVerifiedABI: null,
        contractABI: null,
      }));
    }

    // State overrides
    const so = searchParams.get("stateOverrides");
    if (so) {
      const parsed = JSON.parse(so) as Record<
        string,
        { balance?: string; stateDiff?: Record<string, string> }
      >;

      defaultState.hypeBalanceOverrides = Object.entries(parsed)
        .filter(([_, o]) => o.balance)
        .map(([address, o]) => ({ key: address, value: o.balance as string }));

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

// ---------- Component ----------
export default function BundleSimulatorPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params?.slug || "bundle-v1";

  const [bundleState, setBundleState] = useState<BundleState>({
    blockNumber: "",
    isAtomic: true,
    transactions: [],
    hypeBalanceOverrides: [],
    stateOverrideContracts: [],
  });

  const [isLoading, setIsLoading] = useState(false);
  const [currentBlock, setCurrentBlock] = useState<number | null>(null);
  const [globalStateExpanded, setGlobalStateExpanded] = useState(false);

  // Debounce timers per-transaction for ABI fetch
  const abiTimersRef = useRef<Record<string, number | undefined>>({});

  // Hydrate
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if ([...sp.keys()].length === 0) return;

    const hydrated = deserializeBundleFromQuery(sp);
    setBundleState(hydrated);
  }, []);

  // URL sync
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

  // Current block
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
          const latestBlock = parseInt(data.result, 16);
          setCurrentBlock(latestBlock);

          if (!bundleState.blockNumber) {
            setBundleState((prev) => ({
              ...prev,
              blockNumber: String(latestBlock),
            }));
          }
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
  }, [bundleState.blockNumber]);

  // ------- State updaters -------
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

  // ABI fetching (per transaction)
  const fetchABIForTransaction = async (
    transactionId: string,
    contractAddress: string
  ) => {
    const addr = contractAddress.trim();
    if (!addr) {
      updateTransaction(transactionId, {
        isLoadingABI: false,
        isVerifiedABI: null,
        contractABI: null,
        selectedFunction: null,
        functionParameters: [],
      });
      return;
    }

    updateTransaction(transactionId, {
      isLoadingABI: true,
      isVerifiedABI: null,
      contractABI: null,
      selectedFunction: null,
      functionParameters: [],
    });

    const abi = await fetchContractABI(addr);
    updateTransaction(transactionId, {
      isLoadingABI: false,
      isVerifiedABI: !!abi,
      contractABI: abi,
      selectedFunction: null,
      functionParameters: [],
    });
  };

  const handleFunctionSelect = (
    transactionId: string,
    functionName: string
  ) => {
    const tx = bundleState.transactions.find((t) => t.id === transactionId);
    if (tx?.contractABI) {
      const func = tx.contractABI.functions.find(
        (f) => f.name === functionName
      );
      if (func) {
        const params = func.inputs.map((input, index) => ({
          name: input.name || `param${index}`,
          type: input.type,
          value: "",
        }));
        updateTransaction(transactionId, {
          selectedFunction: func,
          functionParameters: params,
        });
      }
    }
  };

  const handleParameterChange = (
    transactionId: string,
    paramIndex: number,
    value: string
  ) => {
    const tx = bundleState.transactions.find((t) => t.id === transactionId);
    if (!tx) return;

    const updatedParams = [...tx.functionParameters];
    updatedParams[paramIndex].value = value;

    // update params
    updateTransaction(transactionId, { functionParameters: updatedParams });

    // re-encode input
    if (tx.selectedFunction && tx.contractABI) {
      const encodedInput = encodeFunctionCall(
        tx.selectedFunction.name,
        updatedParams,
        tx.contractABI
      );
      updateTransaction(transactionId, { input: encodedInput });
    }
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
      // keep your route (change if your view page differs)
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
      {/* Header with Block Number and Atomic Toggle */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Transaction Bundle</h1>
          <div className="flex items-center gap-6">
            <div className="text-sm text-gray-400">
              {bundleState.transactions.length} transaction(s) in bundle
            </div>
          </div>
        </div>
      </div>

      {/* Line 2: split left/right */}
      <div className="mt-3 mb-3 flex items-center justify-between">
        {/* Left: Block Number + Current */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-gray-400">Block Number:</Label>
          <Input
            placeholder="Block number"
            value={currentBlock || 0}
            onChange={(e) =>
              setBundleState((prev) => ({
                ...prev,
                blockNumber: e.target.value,
              }))
            }
            className="w-40 h-8 text-sm"
            style={{
              backgroundColor: "var(--bg-primary)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
            }}
          />
          {currentBlock && (
            <span className="text-xs text-gray-400">
              Current: {currentBlock}
            </span>
          )}
        </div>

        {/* Right: Atomic Execution slider */}
        <div className="flex items-center gap-3">
          <Label className="text-sm text-gray-400">Atomic Execution</Label>
          <ReactSwitch
            checked={bundleState.isAtomic}
            onChange={(val) =>
              setBundleState((prev) => ({ ...prev, isAtomic: val }))
            }
            onColor="#17BEBB" // teal ribbon when ON
            offColor="#6B7280" // gray when OFF
            uncheckedIcon={false}
            checkedIcon={false}
            handleDiameter={20}
            height={24}
            width={46}
          />
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
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
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
                      <div className="grid grid-cols-3 gap-4">
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
                          <div className="relative">
                            <Input
                              placeholder="0x..."
                              value={transaction.to}
                              onChange={(e) => {
                                const newAddr = e.target.value;
                                updateTransaction(transaction.id, {
                                  to: newAddr,
                                });

                                // Debounce per tx id
                                const id = transaction.id;
                                if (abiTimersRef.current[id]) {
                                  clearTimeout(abiTimersRef.current[id]);
                                }
                                abiTimersRef.current[id] = window.setTimeout(
                                  () => {
                                    fetchABIForTransaction(id, newAddr);
                                  },
                                  600
                                );
                              }}
                              className="border"
                              style={{
                                backgroundColor: "var(--bg-primary)",
                                borderColor: "var(--border)",
                                color: "var(--text-primary)",
                                opacity: 0.8,
                              }}
                              required
                            />
                            {/* inline loader at right */}
                            {transaction.isLoadingABI && (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                              </div>
                            )}
                          </div>
                          {/* verified / not verified hint */}
                          {transaction.to.trim() &&
                            !transaction.isLoadingABI && (
                              <>
                                {transaction.isVerifiedABI === true && (
                                  <p className="text-xs text-green-400 mt-1">
                                    ✓ Contract verified — functions loaded
                                  </p>
                                )}
                                {transaction.isVerifiedABI === false && (
                                  <p className="text-xs text-yellow-400 mt-1">
                                    ⚠ Contract not verified or ABI not found
                                  </p>
                                )}
                              </>
                            )}
                        </div>
                      </div>

                      {/* Function/Raw Input Selection */}
                      {transaction.to.trim() && (
                        <div className="space-y-4">
                          <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id={`function-${transaction.id}`}
                                name={`inputType-${transaction.id}`}
                                checked={transaction.inputType === "function"}
                                onChange={() =>
                                  updateTransaction(transaction.id, {
                                    inputType: "function",
                                  })
                                }
                                style={{ accentColor: "var(--color-primary)" }}
                              />
                              <Label
                                htmlFor={`function-${transaction.id}`}
                                className="text-secondary"
                                style={{ color: "var(--text-secondary)" }}
                              >
                                Choose function and parameters
                              </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="radio"
                                id={`raw-${transaction.id}`}
                                name={`inputType-${transaction.id}`}
                                checked={transaction.inputType === "raw"}
                                onChange={() =>
                                  updateTransaction(transaction.id, {
                                    inputType: "raw",
                                  })
                                }
                                style={{ accentColor: "var(--color-primary)" }}
                              />
                              <Label
                                htmlFor={`raw-${transaction.id}`}
                                className="text-secondary"
                                style={{ color: "var(--text-secondary)" }}
                              >
                                Enter raw input data
                              </Label>
                            </div>
                          </div>

                          {transaction.inputType === "function" && (
                            <div>
                              <Label
                                className="text-secondary mb-2 block"
                                style={{ color: "var(--text-secondary)" }}
                              >
                                Select function
                              </Label>
                              {transaction.contractABI ? (
                                <Select
                                  onValueChange={(value) =>
                                    handleFunctionSelect(transaction.id, value)
                                  }
                                >
                                  <SelectTrigger
                                    className="border"
                                    style={{
                                      backgroundColor: "var(--bg-primary)",
                                      borderColor: "var(--border)",
                                      color: "var(--text-primary)",
                                      opacity: 0.8,
                                    }}
                                  >
                                    <SelectValue placeholder="Select a function" />
                                  </SelectTrigger>
                                  <SelectContent
                                    className="border"
                                    style={{
                                      backgroundColor: "var(--bg-primary)",
                                      borderColor: "var(--border)",
                                      color: "var(--text-primary)",
                                    }}
                                  >
                                    {transaction.contractABI.functions.map(
                                      (func, i) => (
                                        <SelectItem key={i} value={func.name}>
                                          {getFunctionDisplayName(func)}
                                        </SelectItem>
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <div
                                  className="p-3 border rounded text-sm text-gray-400"
                                  style={{
                                    backgroundColor: "var(--bg-primary)",
                                    borderColor: "var(--border)",
                                  }}
                                >
                                  Enter a verified contract address to load
                                  functions
                                </div>
                              )}

                              {transaction.selectedFunction &&
                                transaction.functionParameters.length > 0 && (
                                  <div className="mt-4">
                                    <Label
                                      className="text-secondary mb-2 block"
                                      style={{ color: "var(--text-secondary)" }}
                                    >
                                      Function Parameters
                                    </Label>
                                    <div className="space-y-2">
                                      {transaction.functionParameters.map(
                                        (param, paramIndex) => (
                                          <div key={paramIndex}>
                                            <Label className="text-xs text-gray-400 block mb-1">
                                              {param.name} ({param.type})
                                            </Label>
                                            <Input
                                              placeholder={`Enter ${param.name}`}
                                              value={param.value}
                                              onChange={(e) =>
                                                handleParameterChange(
                                                  transaction.id,
                                                  paramIndex,
                                                  e.target.value
                                                )
                                              }
                                              className="border text-sm"
                                              style={{
                                                backgroundColor:
                                                  "var(--bg-primary)",
                                                borderColor: "var(--border)",
                                                color: "var(--text-primary)",
                                                opacity: 0.8,
                                              }}
                                            />
                                          </div>
                                        )
                                      )}
                                    </div>
                                  </div>
                                )}
                            </div>
                          )}

                          {transaction.inputType === "raw" && (
                            <div>
                              <Label
                                className="text-secondary mb-2 block"
                                style={{ color: "var(--text-secondary)" }}
                              >
                                Raw input data
                              </Label>
                              <Textarea
                                placeholder="Enter raw input data (hex format)"
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
                          )}
                        </div>
                      )}

                      {/* Row B: Gas and Gas Price on one line */}
                      <div className="grid grid-cols-2 gap-4">
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

                        <div>
                          <Label
                            className="text-secondary mb-2 block"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            Gas Price
                          </Label>
                          <Input
                            placeholder="0"
                            value={transaction.gasPrice}
                            onChange={(e) =>
                              updateTransaction(transaction.id, {
                                gasPrice: e.target.value,
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

                      {/* Row A: Value (left) and Access List (right) on one line (50/50) */}
                      <div className="grid grid-cols-2 gap-4">
                        {/* Value */}
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

                        {/* Access List (inline header + add button) */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <Label
                              className="text-secondary"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              Access List (Optional)
                            </Label>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const updatedAccessList = [
                                  ...transaction.accessList,
                                  { address: "", storageKeys: [""] },
                                ];
                                updateTransaction(transaction.id, {
                                  accessList: updatedAccessList,
                                });
                              }}
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
                          {/* Keep your existing access list cards below; no visual change requested */}
                          {transaction.accessList.map(
                            (accessItem, accessIndex) => (
                              <div
                                key={accessIndex}
                                className="border border-gray-600 rounded-lg p-3 mb-2 space-y-2"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-gray-400">
                                    Contract {accessIndex + 1}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      const updatedAccessList =
                                        transaction.accessList.filter(
                                          (_, i) => i !== accessIndex
                                        );
                                      updateTransaction(transaction.id, {
                                        accessList: updatedAccessList,
                                      });
                                    }}
                                    className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                                  >
                                    ×
                                  </Button>
                                </div>

                                <Input
                                  placeholder="Contract Address (0x...)"
                                  value={accessItem.address}
                                  onChange={(e) => {
                                    const updatedAccessList = [
                                      ...transaction.accessList,
                                    ];
                                    updatedAccessList[accessIndex].address =
                                      e.target.value;
                                    updateTransaction(transaction.id, {
                                      accessList: updatedAccessList,
                                    });
                                  }}
                                  className="border text-sm"
                                  style={{
                                    backgroundColor: "var(--bg-primary)",
                                    borderColor: "var(--border)",
                                    color: "var(--text-primary)",
                                    opacity: 0.8,
                                  }}
                                />

                                {accessItem.storageKeys.map((key, keyIndex) => (
                                  <div
                                    key={keyIndex}
                                    className="flex items-center space-x-2 pl-4"
                                  >
                                    <Input
                                      placeholder="Storage Key (0x...)"
                                      value={key}
                                      onChange={(e) => {
                                        const updatedAccessList = [
                                          ...transaction.accessList,
                                        ];
                                        updatedAccessList[
                                          accessIndex
                                        ].storageKeys[keyIndex] =
                                          e.target.value;
                                        updateTransaction(transaction.id, {
                                          accessList: updatedAccessList,
                                        });
                                      }}
                                      className="border flex-1 text-sm"
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
                                      onClick={() => {
                                        const updatedAccessList = [
                                          ...transaction.accessList,
                                        ];
                                        updatedAccessList[
                                          accessIndex
                                        ].storageKeys = updatedAccessList[
                                          accessIndex
                                        ].storageKeys.filter(
                                          (_, i) => i !== keyIndex
                                        );
                                        updateTransaction(transaction.id, {
                                          accessList: updatedAccessList,
                                        });
                                      }}
                                      className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                                    >
                                      ×
                                    </Button>
                                  </div>
                                ))}

                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const updatedAccessList = [
                                      ...transaction.accessList,
                                    ];
                                    updatedAccessList[
                                      accessIndex
                                    ].storageKeys.push("");
                                    updateTransaction(transaction.id, {
                                      accessList: updatedAccessList,
                                    });
                                  }}
                                  className="w-full h-6 text-xs"
                                  style={{
                                    borderColor: "var(--border)",
                                    color: "var(--text-secondary)",
                                  }}
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  Add Storage Key
                                </Button>
                              </div>
                            )
                          )}
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
                            <span className="text-gray-400">Value:</span>
                            <span className="ml-2 font-mono text-blue-400">
                              {truncateData(transaction.input)}
                            </span>
                          </div>
                          <div className="text-sm">
                            <span className="text-gray-400">Gas:</span>
                            <span
                              className="ml-2 font-mono"
                              style={{ color: "var(--text-primary)" }}
                            >
                              {transaction.gas}
                            </span>
                            <span className="text-gray-400 ml-4">
                              Gas Price:
                            </span>
                            <span
                              className="ml-2 font-mono"
                              style={{ color: "var(--text-primary)" }}
                            >
                              {transaction.gasPrice}
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
                  Bundle Simulate ({bundleState.transactions.length}{" "}
                  transactions)
                </span>
              </div>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
