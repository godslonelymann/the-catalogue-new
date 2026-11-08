import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "./App";
import { ApiContext } from "./api/ApiContext";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { createMockApi } from "./test/mock/mockApi";

function renderApp(path: string, api = createMockApi({ delayMs: 0 })) {
  render(
    <ApiContext value={api}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </ApiContext>,
  );
  return api;
}

async function signedInApi() {
  const api = createMockApi({ delayMs: 0 });
  await api.signIn("anurag.works@example.com", "sample-password");
  return api;
}

describe("private routes", () => {
  it("sends a signed-out visitor from a private page to sign-in", async () => {
    renderApp("/stores/fugazee/products/123");
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByText("Fugazee")).not.toBeInTheDocument();
  });

  it("signs in with email and opens an empty My Stores", async () => {
    const user = userEvent.setup();
    renderApp("/stores");
    await user.type(await screen.findByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "sample-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { level: 1, name: "My Stores" })).toBeInTheDocument();
    expect(await screen.findByText("0 of 10 brands")).toBeInTheDocument();
    expect(screen.getByText("Follow your first store")).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("shell", () => {
  it("shows exactly three primary links and marks the current section", async () => {
    renderApp("/stores/fugazee", await signedInApi());
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links.map(link => link.textContent)).toEqual(["My Stores", "Updates", "Saved"]);
    expect(within(nav).getByRole("link", { name: "My Stores" })).toHaveAttribute("aria-current", "location");
  });

  it("names the profile trigger with the full email", async () => {
    renderApp("/stores", await signedInApi());
    expect(await screen.findByRole("button", { name: "Profile menu for anurag.works@example.com" })).toBeInTheDocument();
    expect(screen.getByText("AW")).toBeInTheDocument();
  });

  it("redirects /account to Settings on the Profile tab", async () => {
    renderApp("/account?google=linked", await signedInApi());
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("Google is now linked to your account.")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Profile", "Password", "Two-factor authentication", "Devices"]);
  });
});

describe("two-factor setup", () => {
  it("shows a QR code of the otpauth link, with the key as a fallback", async () => {
    const user = userEvent.setup();
    renderApp("/stores?settings=two-factor", await signedInApi());
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Set up" }));

    const qr = await within(dialog).findByRole("img", { name: "QR code for two-factor setup" });
    const svg = qr.querySelector("svg");
    expect(svg).not.toBeNull();
    // A QR code is a grid of dark modules drawn as one path.
    expect(svg!.querySelectorAll("path").length).toBeGreaterThan(0);

    const key = within(dialog).getByLabelText("Setup key");
    expect(key).not.toBeVisible();
    await user.click(within(dialog).getByText("Can’t scan the code? Enter a key instead"));
    expect(key).toBeVisible();
    expect(key.textContent).toMatch(/^([A-Z2-7]{4} ?)+$/);
  });
});

describe("Add a store", () => {
  it("shows each failure beside the field and keeps the URL", async () => {
    const user = userEvent.setup();
    renderApp("/stores", await signedInApi());
    await user.click(await screen.findByRole("button", { name: "Add a store" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a store" });
    const input = within(dialog).getByLabelText("Store URL");
    await waitFor(() => expect(input).toHaveFocus());

    await user.type(input, "https://fugazee.com/products/racer");
    await user.click(within(dialog).getByRole("button", { name: "Add store" }));
    expect(within(dialog).getByText("Enter the store’s home page, not a product page.")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "https://example.com");
    await user.click(within(dialog).getByRole("button", { name: "Add store" }));
    expect(await within(dialog).findByText("Only supported Shopify stores can be added.")).toBeInTheDocument();
    expect(input).toHaveValue("https://example.com");

    await user.clear(input);
    await user.type(input, "https://offline-shop.in");
    await user.click(within(dialog).getByRole("button", { name: "Add store" }));
    expect(await within(dialog).findByText("We couldn’t check this store. Try again later.")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "fugazee.com");
    await user.click(within(dialog).getByRole("button", { name: "Add store" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a store" })).not.toBeInTheDocument());
    expect(await screen.findByText("1 of 10 brands")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Monitored stores" });
    expect(within(list).getByText("Fugazee")).toBeInTheDocument();
    expect(within(list).getByText("Ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add a store" }));
    const again = await screen.findByRole("dialog", { name: "Add a store" });
    await user.type(within(again).getByLabelText("Store URL"), "www.fugazee.com");
    await user.click(within(again).getByRole("button", { name: "Add store" }));
    expect(await within(again).findByText(/You already monitor Fugazee\./)).toBeInTheDocument();
  });

  it("shows the brand limit beside the field", async () => {
    const user = userEvent.setup();
    const api = await signedInApi();
    await api.sample.addSampleBrands(10);
    renderApp("/stores", api);
    expect(await screen.findByText("10 of 10 brands")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a store" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a store" });
    await user.type(within(dialog).getByLabelText("Store URL"), "https://northline.store");
    await user.click(within(dialog).getByRole("button", { name: "Add store" }));
    expect(await within(dialog).findByText("You monitor 10 brands, the limit. Remove a brand to add a new one.")).toBeInTheDocument();
  });

  it("confirms removal and keeps the row until the API confirms", async () => {
    const user = userEvent.setup();
    const api = await signedInApi();
    await api.addStore("https://fugazee.com");
    renderApp("/stores", api);
    await user.click(await screen.findByRole("button", { name: "Remove Fugazee" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Remove Fugazee?" });
    // The modal hides the page from assistive technology, but the row is still there.
    expect(screen.getByRole("list", { name: "Monitored stores", hidden: true })).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Remove Fugazee" }));
    expect(await screen.findByText("Follow your first store")).toBeInTheDocument();
  });
});

describe("product detail", () => {
  it("sets an alert for one exact sold-out variant, which also saves the product", async () => {
    const user = userEvent.setup();
    const api = await signedInApi();
    await api.addStore("https://fugazee.com");
    const { items } = await api.listProducts("fugazee", {});
    const detail = await api.getProduct("fugazee", items[0].id);
    const soldOut = detail.variants.find(variant => !variant.available)!;

    renderApp(`/stores/fugazee/products/${detail.id}`, api);
    await screen.findByRole("heading", { level: 1, name: detail.title });
    // The first option in stock is chosen: the store link opens it, and there is no alert to set.
    const inStock = detail.variants.find(variant => variant.available)!;
    expect(screen.getByRole("link", { name: /^Buy on store/ })).toHaveAttribute("href", `${detail.url}?variant=${inStock.id}`);
    expect(screen.queryByRole("button", { name: "Email me when it’s back" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Price history" })).toBeInTheDocument();

    const [colour, size] = soldOut.options;
    await user.click(screen.getByRole("button", { name: new RegExp(`^Colour ${colour},`) }));
    await user.click(screen.getByRole("button", { name: new RegExp(`^Size ${size},`) }));
    // A sold-out size doesn't cross out its colour while another size of that colour is in stock.
    const colourInStock = detail.variants.some(variant => variant.options[0] === colour && variant.available);
    expect(screen.getByRole("button", { name: new RegExp(`^Colour ${colour},`) })).toHaveAccessibleName(
      `Colour ${colour}, ${colourInStock ? "in stock" : "sold out"}`,
    );
    await user.click(screen.getByRole("button", { name: "Email me when it’s back" }));
    expect(await screen.findByText("Watching this size")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Remove ${detail.title} from Saved` })).toHaveAttribute("aria-pressed", "true");

    const alerts = await api.listAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].variantId).toBe(soldOut.id);
    const [saved] = await api.listWishlist();
    expect(saved.product.id).toBe(detail.id);
    expect(saved.alerts.map(alert => [alert.variantId, alert.status])).toEqual([[soldOut.id, "active"]]);
  });
});
