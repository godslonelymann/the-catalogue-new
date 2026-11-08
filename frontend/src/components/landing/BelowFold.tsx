import { Faq } from "./Faq";
import { Features } from "./Features";
import { FinalCta } from "./FinalCta";
import { HowItWorks } from "./HowItWorks";
import { LandingFooter } from "./LandingFooter";
import { ProofStrip } from "./ProofStrip";

/** Everything under the hero. LandingPage loads this chunk lazily. */
export default function BelowFold() {
  return (
    <>
      <ProofStrip />
      <HowItWorks />
      <Features />
      <Faq />
      <FinalCta />
      <LandingFooter />
    </>
  );
}
