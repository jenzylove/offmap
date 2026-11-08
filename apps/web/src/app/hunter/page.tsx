import type { Metadata } from "next";
import { Contours } from "@/components/Contours";
import { PageHead } from "@/components/Bits";
import { HunterView } from "./HunterView";

export const metadata: Metadata = { title: "Hunter view · Offmap" };

export default function HunterPage() {
  return (
    <section className="gutter relative overflow-hidden">
      <Contours seed={5} peaks={3} className="opacity-50" />
      <div className="wrap relative pb-24">
        <PageHead sheet="Sheet 04 · Hunter view" title={<>Everything a hunter can read.</>}>
          This page uses only public data: Morpho on Base, the Morpho public API and the Offmap contract on NEAR. Look for any single Offmap user. You will not find one.
        </PageHead>
        <HunterView />
      </div>
    </section>
  );
}
