import type { Metadata } from "next";
import { TokensView } from "@/components/tokens-view";

export const metadata: Metadata = { title: "Tokens" };

export default function TokensPage() {
  return <TokensView />;
}
