import type { Metadata } from "next";
import { AppFlow } from "./AppFlow";

export const metadata: Metadata = { title: "Borrow · Offmap" };

export default function BorrowPage() {
  return <AppFlow />;
}
