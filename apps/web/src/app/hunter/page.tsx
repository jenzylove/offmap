import type { Metadata } from "next";
import { HunterView } from "./HunterView";

export const metadata: Metadata = { title: "What hunters see · Offmap" };

export default function HunterPage() {
  return <HunterView />;
}
