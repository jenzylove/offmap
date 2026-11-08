import type { Metadata } from "next";
import { BorrowFlow } from "./BorrowFlow";

export const metadata: Metadata = { title: "Borrow · Offmap" };

export default function BorrowPage() {
  return (
    <section className="gutter relative">
      <div className="wrap pb-24">
        <BorrowFlow />
      </div>
    </section>
  );
}
