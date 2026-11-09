import type { Metadata } from "next";
import { PageHead } from "@/components/Bits";
import { EjectFlow } from "./EjectFlow";

export const metadata: Metadata = { title: "Eject · Offmap" };

export default function EjectPage() {
  return (
    <section className="gutter relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_60%_80%_at_80%_0%,rgba(127,233,255,0.07),transparent_70%)]" />
      <div className="wrap pb-24">
        <PageHead sheet="Eject · the exit that needs nobody" title={<>Leave on your <span className="text-cold-grad">own terms.</span></>}>
          Eject moves your share of the pooled position into a Morpho position owned by your own wallet on Base, in one transaction, through the NEAR contract. It works even if the Offmap agent is down. You give up privacy for that loan, never your money.
        </PageHead>
        <EjectFlow />
      </div>
    </section>
  );
}
