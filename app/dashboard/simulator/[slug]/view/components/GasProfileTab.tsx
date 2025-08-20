"use client";

import React, { useMemo } from "react";
import { ResponsiveIcicle } from "@nivo/icicle";



export default function GasProfileTab({
  responseData,
  decodedTraceTree,
}: {
  responseData: any;
  decodedTraceTree: any;
}) {
  // ---------- helpers ----------
  const functionDisplay = (trace: any) => {
    if (trace?.functionName) return String(trace.functionName).split("(")[0];
    if (trace?.functionSelector) return String(trace.functionSelector);
    const raw = trace?.inputRaw ?? trace?.input;
    if (raw && raw !== "0x") return String(raw).slice(0, 10);
    if (!raw || raw === "0x") return "fallback()";
    return "unknown";
  };

  const nameFromSignature = (sig?: string) => {
    if (!sig) return undefined;
    const m = String(sig).match(/^([^(]+)/);
    return m?.[1];
  };

  const labelFromNode = (node: any): string => {
    let base: string;
    if (node?.signature) {
      const fromSig = nameFromSignature(node.signature);
      if (node?.functionName) base = String(node.functionName).split("(")[0];
      else if (fromSig) base = fromSig;
      else base = functionDisplay(node);
    } else {
      base = functionDisplay(node);
    }
    const gas = gasUsedNum(node);
    return `${base} - ${gas} GAS`;
  };

  const gasUsedNum = (node: any): number => {
    const g = node?.gasUsed ?? node?.gas_used ?? node?.gas;
    const n = Number(g);
    return Number.isFinite(n) ? n : 0;
  };

  const childrenOf = (node: any): any[] => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node.children)) return node.children;
    if (Array.isArray(node.calls)) return node.calls;
    return [];
  };

  const convertRawCallTrace = (t: any): any => ({
    functionName: undefined,
    signature: undefined,
    functionSelector:
      typeof t?.input === "string" && t.input.startsWith("0x")
        ? String(t.input).slice(0, 10)
        : undefined,
    inputRaw: t?.input,
    gasUsed: t?.gasUsed ?? t?.gas_used ?? t?.gas,
    children: Array.isArray(t?.calls) ? t.calls.map(convertRawCallTrace) : [],
  });

  const normalizeRoot = (decoded: any): any[] => {
    if (!decoded) return [];
    if (Array.isArray(decoded)) return decoded;
    if (decoded.root && typeof decoded.root === "object") return [decoded.root];
    return [decoded];
  };

  // ---------- color lighten ----------
  const lighten = (hex: string, amount: number) => {
    const h = hex.replace("#", "");
    const num = parseInt(h, 16);
    let r = (num >> 16) & 0xff;
    let g = (num >> 8) & 0xff;
    let b = num & 0xff;
    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (255 - g) * amount);
    b = Math.round(b + (255 - b) * amount);
    const toHex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  // ---------- build the tree ----------
  const nivoData = useMemo(() => {
    const decodedRoots = normalizeRoot(decodedTraceTree);
    let roots: any[] = decodedRoots;

    if (!decodedTraceTree || decodedRoots.length === 0) {
      const raw = responseData?.transaction?.callTrace;
      const rawRoots = Array.isArray(raw) ? raw : raw ? [raw] : [];
      roots = rawRoots.map(convertRawCallTrace).filter(Boolean);
    }

    const normalize = (node: any): any => {
      const id = labelFromNode(node); // now includes functionName + gas
      const value = gasUsedNum(node);
      const kids = childrenOf(node).map(normalize);
      return kids.length > 0 ? { id, value, children: kids } : { id, value };
    };

    const children = roots.map(normalize);
    const dataRoot = children.length === 1 ? children[0] : { id: "", children };

    console.log("[GasProfileTab] Icicle data:", JSON.stringify(dataRoot, null, 2));
    return dataRoot;
  }, [decodedTraceTree, responseData]);

  const getDepth = (node: any, depth = 1): number => {
    if (!node.children || node.children.length === 0) return depth;
    return Math.max(...node.children.map((c: any) => getDepth(c, depth + 1)));
  };
  
  // inside your component:
  const depth = getDepth(nivoData);
  const rowHeight = 40; // px per level, tweak smaller for thinner bars
  const chartHeight = depth * rowHeight;

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Gas Profiler</h3>

      <div
        className="border rounded-lg"
        style={{
          height: chartHeight,
          backgroundColor: "rgba(30,30,30,0.6)",
          borderColor: "var(--border)",
        }}
      >
        <ResponsiveIcicle
                margin={{ top: 3, right: 3, bottom: 3, left: 3 }}

          data={nivoData}
          valueFormat=">-.0s"
          enableLabels={true}
          labelBoxAnchor="center"
          labelPaddingX={3}
          labelPaddingY={2}
          labelAlign="end"
          labelBaseline="center"
          labelRotation={0}
          labelSkipWidth={150}
          borderRadius={13}
          label={(n) => (n?.id as string) ?? ""}
          colors={(node: any) => {
            const base = "#17BEBB";
            const depth = Number(node.depth ?? 0);
            const t = Math.min(0.12 * depth, 0.8);
            return lighten(base, t);
          }}
          borderColor={{ from: "color", modifiers: [["darker", 0.6]] }}
          theme={{
            text: { fill: "#e5e7eb" },
            axis: { ticks: { text: { fill: "#9ca3af" } } },
            tooltip: {
              container: { background: "#111827", color: "#e5e7eb" },
            },
          }}
          tooltip={(node) => (
            <div
              style={{
                padding: "6px 8px",
                background: "#111827",
                border: "1px solid #374151",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <div style={{ fontFamily: "monospace" }}>{String(node.id)}</div>
              <div style={{ opacity: 0.8 }}>{Number(node.value)} gas</div>
            </div>
          )}
        />
      </div>

      {/* Recommended Access List (unchanged) */}
      <div className="p-1 rounded-lg">
        <div className="mb-4">
          <h4 className="text-lg font-semibold text-white mb-2">
            Recommended Access List
          </h4>
          <p className="text-gray-400 text-sm mb-2">
            The suggested list of addresses and storage keys to pass for this
            transaction to minimize gas costs.
          </p>
        </div>

        <div
          className="space-y-3 border w-1/2 rounded-xl"
          style={{
            backgroundColor: "rgba(40, 40, 40, 0.6)",
            borderColor: "var(--border)",
          }}
        >
          {responseData?.generated_access_list?.map(
            (accessItem: any, index: number) => (
              <div
                key={index}
                className="border-b border-gray-700 pb-1 last:border-b-0 pl-3"
              >
                <div className="flex items-center space-x-3 mb-2">
                  <img
                    src="/shapes/shape7.png"
                    alt="Address"
                    className="w-6 h-6 rounded object-cover"
                  />
                  <span className="text-white font-mono text-sm">
                    {accessItem.address
                      ? `${accessItem.address.slice(
                          0,
                          10
                        )}...${accessItem.address.slice(-6)}`
                      : "Unknown Address"}
                  </span>
                </div>

                {accessItem.storageKeys?.length > 0 && (
                  <div className="ml-9 space-y-1">
                    {accessItem.storageKeys.map(
                      (storageKey: string, keyIndex: number) => (
                        <div
                          key={keyIndex}
                          className="flex items-center space-x-2"
                        >
                          <div className="w-4 h-4 text-gray-500">
                            <svg
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="w-4 h-4"
                            >
                              <path d="M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
                              <path d="M16 21V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v17" />
                            </svg>
                          </div>
                          <span className="text-gray-300 font-mono text-sm break-all">
                            {storageKey || "Unknown Key"}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
