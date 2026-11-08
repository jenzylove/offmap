import type { Metadata } from "next";
import { PageHead } from "@/components/Bits";
import { ProofSheet } from "./ProofSheet";

export const metadata: Metadata = { title: "Proof · Offmap" };

export default function ProofPage() {
  return (
    <section className="gutter relative">
      <div className="wrap pb-24">
        <PageHead sheet="Sheet 05 · Proof" title={<>Check every claim yourself.</>}>
          The sealed hardware, the code the contract accepts, the solvency statements, the reserve and the leak study. Each line reads live or links to where it lives on chain.
        </PageHead>
        <ProofSheet />
      </div>
    </section>
  );
}
