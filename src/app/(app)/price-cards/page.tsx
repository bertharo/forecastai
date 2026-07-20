import { redirect } from "next/navigation";

/** Price cards moved under Sources — keep old URL working. */
export default function PriceCardsRedirect() {
  redirect("/connectors#price-cards");
}
