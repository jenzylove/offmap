import type { Metadata } from "next";
import { PositionView } from "./PositionView";

export const metadata: Metadata = { title: "Your view · Offmap" };

export default function PositionPage() {
  return (
    <section className="gutter relative">
      <div className="wrap pb-24">
        <PositionView />
      </div>
    </section>
  );
}
