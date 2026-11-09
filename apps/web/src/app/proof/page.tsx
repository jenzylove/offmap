import type { Metadata } from "next";
import { PageHead } from "@/components/Bits";
import { ProofSheet } from "./ProofSheet";

export const metadata: Metadata = { title: "Proof · Offmap" };

export default function ProofPage() {
  return (
    <section className="gutter relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_60%_80%_at_80%_0%,rgba(127,233,255,0.08),transparent_70%)]" />
      <div className="wrap pb-24">
        <PageHead sheet="Proof · checked live in your browser" title={<>Don&apos;t trust us. <span className="text-cold-grad">Check.</span></>}>
          Four promises, each tested right now against NEAR, Base and the agent itself. A cold light means it passes. Open any one to see the raw data behind it.
        </PageHead>
        <ProofSheet />
      </div>
    </section>
  );
}
