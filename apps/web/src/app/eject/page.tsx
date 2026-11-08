import type { Metadata } from "next";
import { PageHead } from "@/components/Bits";
import { EjectFlow } from "./EjectFlow";

export const metadata: Metadata = { title: "Eject · Offmap" };

export default function EjectPage() {
  return (
    <section className="gutter relative">
      <div className="wrap pb-24">
        <PageHead sheet="Sheet 06 · Eject" title={<>The exit that needs nobody.</>}>
          Eject moves your share of a cohort into a Morpho position owned by your own wallet on Base, in one transaction, through the NEAR contract. It works even if the Offmap agent is down. You give up privacy for that loan, never your money.
        </PageHead>
        <EjectFlow />
      </div>
    </section>
  );
}
