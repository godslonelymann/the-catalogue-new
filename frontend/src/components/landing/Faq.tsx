import { SectionHeading } from "./SectionHeading";
import { UnfoldAccordion } from "./ui/unfold-accordion";

// Answers follow the product rules in the project README.
const items = [
  {
    id: "stores",
    title: "Which stores work?",
    content:
      "Shopify stores. Paste the store’s main address, not a product link. We check the store before we add it, and refuse addresses that are not Shopify.",
  },
  {
    id: "often",
    title: "How often do you check?",
    content: "Once a day. Each check reads the store’s full catalogue: prices, stock, and every size and colour.",
  },
  {
    id: "limit",
    title: "How many stores can I add?",
    content: "Up to 10 Shopify brands per account. Each account sees only its own stores and saved products.",
  },
  {
    id: "email",
    title: "Will you fill my inbox?",
    content: "No. You pick one exact size and colour. We send one email when that variant returns.",
  },
  {
    id: "leaves",
    title: "What if a store leaves Shopify?",
    content: "We mark it as “latest check failed”. Its catalogue still shows, and adding it again runs a new check.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="l-section">
      <div className="l-wrap grid gap-2 md:grid-cols-12 md:gap-6">
        <div className="md:col-span-4">
          <SectionHeading id="faq-heading" eyebrow="FAQ" title="Questions" align="start" className="md:sticky md:top-[120px]" />
        </div>
        <div className="md:col-span-8">
          <UnfoldAccordion items={items} defaultOpen={["stores"]} />
        </div>
      </div>
    </section>
  );
}
