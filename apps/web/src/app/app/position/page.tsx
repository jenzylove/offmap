import { redirect } from "next/navigation";

/** Your loan now lives at the last step of /app. */
export default function PositionPage() {
  redirect("/app");
}
