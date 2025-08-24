"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { usePathname, useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"   // ⭐ import Sparkles icon

export default function TransactionsPage() {
  const [txHash, setTxHash] = useState("")
  const router = useRouter()
  const pathname = usePathname()

  const handleSearch = () => {
    if (!txHash.trim()) return
    router.push(`${pathname}/${txHash.trim()}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSearch()
    }
  }

  const handleLoadExample = () => {
    const exampleHash = "0x6fd917807b05b721512b17d9dbeb8a8009cb333d89c746ce35343c6c2439b92a"
    setTxHash(exampleHash)
  }

  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-3xl font-bold mb-4">Transactions</h1>

      <div className=" flex items-center justify-between">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Enter transaction hash to see detailed view
        </p>
        
        <Button
          type="button"
          onClick={handleLoadExample}
          variant="outline"
          className="flex items-center gap-2"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-primary)",
            backgroundColor: "rgba(30,30,30,0.6)",
          }}
        >
          <Sparkles className="h-4 w-4" />
          Load Example
        </Button>
      </div>

      <div className="flex space-x-2">
        <Input
          type="text"
          placeholder="Enter transaction hash (0x...)"
          value={txHash}
          onChange={(e) => setTxHash(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1"
        />
        {/* Search button */}
        <Button
          onClick={handleSearch}
          className="border-0 px-6 py-2 rounded-lg font-semibold transition-colors"
          style={{
            backgroundColor: "var(--btn-primary-bg)",
            color: "var(--btn-primary-text)",
          }}
        >
          Search
        </Button>
      </div>
    </div>
  )
}
