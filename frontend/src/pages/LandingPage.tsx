import { useEffect, useState, type CSSProperties } from "react";
import { Link, Navigate } from "react-router";
import { artUrl } from "../lib/art";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { PublicFrame } from "../components/Layout";

// Marketing illustrations only. The landing page shows no store data.
const examples = {
  drop: { image: artUrl("tee", { fill: "#303030", light: "#555", ink: "#f1f1f1", backdrop: "#eee" }), title: "Racer Club Oversized Tee" },
  restock: { image: artUrl("cargo", { fill: "#515151", light: "#919191", ink: "#ddd", backdrop: "#eaeaea" }), title: "Utility Cargo Trousers" },
};

export function LandingPage() {
  const { account, loading } = useAuth();
  const [event, setEvent] = useState<"drop" | "restock">("drop");

  useEffect(() => {
    document.title = "The Catalogue";
  }, []);

  if (!loading && account) return <Navigate to="/stores" replace />;

  return (
    <PublicFrame
      nav={
        <Link className="btn primary" to="/signup">Get started</Link>
      }
    >
      <main id="main" tabIndex={-1}>
        <section className="hero">
          <div className="wrap hero-stack">
            <div className="hero-copy">
              <h1>
                Track prices and restocks from <em>stores you love.</em>
              </h1>
              <p className="muted">Monitor up to 10 Shopify brands. See price drops, and get an email when your size and colour return.</p>
              <Link className="btn primary" to="/signup">
                Get started <Icon name="arrow" />
              </Link>
            </div>
            <section className="hero-figure" aria-labelledby="preview-label">
              <div className="preview">
                <div className="preview-bar between">
                  <h2 id="preview-label">
                    <Icon name="store" />
                    Example update
                  </h2>
                  <div className="pill" role="group" aria-label="Choose an example" style={{ "--position": event === "drop" ? 0 : 1 } as CSSProperties}>
                    <button type="button" aria-pressed={event === "drop"} onClick={() => setEvent("drop")}>Price drop</button>
                    <button type="button" aria-pressed={event === "restock"} onClick={() => setEvent("restock")}>Restock</button>
                  </div>
                </div>
                <div className="preview-body" aria-live="polite">
                  {(["drop", "restock"] as const).map(key => (
                    <div key={key} className={"preview-example" + (key === event ? " is-selected" : "")} aria-hidden={key !== event}>
                      <img src={examples[key].image} alt="" />
                      <div className="preview-event">
                        <span className="preview-kicker mono">
                          <Icon name={key === "drop" ? "down" : "box"} />
                          {key === "drop" ? "Price drop" : "Restock"}
                        </span>
                        <h3>{examples[key].title}</h3>
                        {key === "drop" ? (
                          <>
                            <div className="row numbers">
                              <s>₹1,699</s>
                              <strong className="price">₹1,299</strong>
                            </div>
                            <span className="badge accent">₹400 lower</span>
                          </>
                        ) : (
                          <>
                            <p className="muted">Olive · Size 32</p>
                            <span className="badge accent">Back in stock · Email sent</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </section>
        <section className="steps wrap" aria-labelledby="steps-heading">
          <h2 className="steps-heading" id="steps-heading">How it works</h2>
          <ol className="steps-list">
            <li>
              <div className="step-number">01</div>
              <h3>Add a supported store</h3>
              <p className="muted">Paste a Shopify store’s address. We check it before we add it.</p>
            </li>
            <li>
              <div className="step-number">02</div>
              <h3>Browse the catalogue</h3>
              <p className="muted">See prices, stock, and price history from the daily check.</p>
            </li>
            <li>
              <div className="step-number">03</div>
              <h3>Get a restock email</h3>
              <p className="muted">Pick the exact size and colour. We email you once when it returns.</p>
            </li>
          </ol>
        </section>
      </main>
      <footer className="site-foot">
        <div className="wrap between small muted">
          <span>The Catalogue</span>
          <span>Sign in to see your stores</span>
        </div>
      </footer>
    </PublicFrame>
  );
}
