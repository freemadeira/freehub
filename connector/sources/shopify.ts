import { createHmac, timingSafeEqual } from "node:crypto";

import type { SourceAttribute, SourceFields } from "@/lib/sources";
import { sleep } from "@/lib/utils";

import type { SourceConfig } from "../config";
import { ConfigError } from "../config";
import type { Adapter, Delivery, Item } from "./types";

const DEFAULT_API_VERSION = "2026-10";
const TOPICS = {
  "orders/create": "ORDERS_CREATE",
  "orders/updated": "ORDERS_UPDATED",
};
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u;
/** Refresh the access token this long before Shopify says it expires. */
const TOKEN_MARGIN = 60_000;
const MAX_THROTTLED = 5;
/** Orders per page: each brings its line items, which GraphQL counts towards the cost. */
const PAGE_SIZE = 10;
const MAX_LINE_ITEMS = 50;

interface ShopifySettings {
  shop: string;
  clientId?: string;
  clientSecret: string;
  /** A legacy custom app's static Admin API token, instead of client credentials. */
  accessToken?: string;
  apiVersion: string;
}

interface Money {
  shopMoney: { amount: string };
}

interface Order {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currentTotalPriceSet?: Money;
  lineItems?: { nodes: { name: string; quantity: number }[] };
  customer?: { displayName: string } | null;
  email?: string | null;
  paymentGatewayNames?: string[];
}

interface OrdersPage {
  nodes: Order[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface GraphQLError {
  message: string;
  path?: (string | number)[];
  extensions?: { code?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

interface UserError {
  field?: string[] | null;
  message: string;
}

/** What each attribute asks of an order, and how it reads the answer. */
interface AttributeSpec {
  attribute: Omit<SourceAttribute, "config">;
  selection: string;
  read: (order: Order, adapter: ShopifyAdapter) => string[];
}

function text(value: string | null | undefined): string[] {
  return value?.trim() ? [value.trim()] : [];
}

/** First matching rule wins. */
function orderStatus(order: Order): string {
  const financial = order.displayFinancialStatus?.toUpperCase();
  const fulfillment = order.displayFulfillmentStatus?.toUpperCase();
  if (order.cancelledAt || financial === "VOIDED") {
    return "cancelled";
  }
  if (financial === "REFUNDED") {
    return "refunded";
  }
  if (fulfillment === "FULFILLED") {
    return "fulfilled";
  }
  if (financial === "PAID" || financial === "PARTIALLY_REFUNDED") {
    return "paid";
  }
  return "unpaid";
}

const ATTRIBUTES: AttributeSpec[] = [
  {
    attribute: { id: "order", name: "Order", type: "title", values: [] },
    read: (order) => text(order.name),
    selection: "",
  },
  {
    attribute: { id: "date", name: "Order date", type: "date", values: [] },
    read: (order, adapter) => [adapter.day(order.createdAt)],
    selection: "",
  },
  {
    attribute: { id: "total", name: "Total", type: "currency", values: [] },
    read: (order) => {
      const amount = Number(order.currentTotalPriceSet?.shopMoney.amount);
      return Number.isFinite(amount) ? [String(amount)] : [];
    },
    selection: "currentTotalPriceSet { shopMoney { amount } }",
  },
  {
    attribute: {
      id: "status",
      name: "Status",
      type: "stage",
      values: [
        { color: "gray", id: "unpaid", kind: "open", label: "Unpaid" },
        { color: "blue", id: "paid", kind: "open", label: "Paid" },
        { color: "green", id: "fulfilled", kind: "won", label: "Fulfilled" },
        { color: "orange", id: "refunded", kind: "lost", label: "Refunded" },
        { color: "red", id: "cancelled", kind: "lost", label: "Cancelled" },
      ],
    },
    read: (order) => [orderStatus(order)],
    selection: "cancelledAt displayFinancialStatus displayFulfillmentStatus",
  },
  {
    attribute: { id: "items", name: "Items", type: "longtext", values: [] },
    read: (order) =>
      text(
        order.lineItems?.nodes
          .map((line) => `${line.quantity} × ${line.name}`)
          .join("\n")
      ),
    selection: `lineItems(first: ${MAX_LINE_ITEMS}) { nodes { name quantity } }`,
  },
  {
    attribute: { id: "customer", name: "Customer", type: "text", values: [] },
    read: (order) => text(order.customer?.displayName),
    selection: "customer { displayName }",
  },
  {
    attribute: { id: "email", name: "Email", type: "email", values: [] },
    read: (order) => text(order.email),
    selection: "email",
  },
  {
    attribute: { id: "payment", name: "Payment", type: "text", values: [] },
    read: (order) => text(order.paymentGatewayNames?.join(", ")),
    selection: "paymentGatewayNames",
  },
  {
    attribute: { id: "link", name: "Shopify link", type: "url", values: [] },
    read: (order, adapter) => [adapter.orderUrl(order)],
    selection: "",
  },
];

const ORDER_BASICS = "id legacyResourceId name createdAt updatedAt";

function settings(config: SourceConfig): ShopifySettings {
  const string = (key: string) =>
    typeof config[key] === "string" && config[key].trim()
      ? config[key].trim()
      : undefined;
  const shop = string("shop")?.toLowerCase();
  if (!(shop && SHOP_DOMAIN.test(shop))) {
    throw new ConfigError(
      `Source "${config.id}" needs "shop": the store's <handle>.myshopify.com domain.`
    );
  }
  const clientSecret = string("clientSecret");
  if (!clientSecret) {
    throw new ConfigError(
      `Source "${config.id}" needs "clientSecret", which also checks webhooks.`
    );
  }
  const accessToken = string("accessToken");
  const clientId = string("clientId");
  if (!(accessToken || clientId)) {
    throw new ConfigError(
      `Source "${config.id}" needs "clientId", or a legacy app's "accessToken".`
    );
  }
  return {
    accessToken,
    apiVersion: string("apiVersion") ?? DEFAULT_API_VERSION,
    clientId,
    clientSecret,
    shop,
  };
}

/** The order fields the wanted attributes read. */
function orderSelection(wanted: Set<string>): string {
  return [
    ORDER_BASICS,
    ...ATTRIBUTES.filter(({ attribute }) => wanted.has(attribute.id)).map(
      ({ selection }) => selection
    ),
  ]
    .filter(Boolean)
    .join(" ");
}

function webhookOrderId(body: Buffer): string | undefined {
  try {
    const { admin_graphql_api_id: id } = JSON.parse(body.toString("utf-8"));
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

// The fields an attribute's selection asks for at the top of the order, like
// `customer` in `customer { displayName }`.
function topLevelFields(selection: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  for (const token of selection.match(/[A-Za-z_]\w*|[{}()]/gu) ?? []) {
    if (token === "{" || token === "(") {
      depth += 1;
    } else if (token === "}" || token === ")") {
      depth -= 1;
    } else if (depth === 0) {
      fields.push(token);
    }
  }
  return fields;
}

// A plan or a missing scope keeps the field back, rather than the request failing.
function isWithheld(problem: GraphQLError): boolean {
  return (
    problem.extensions?.code === "ACCESS_DENIED" ||
    /access denied|not approved|protected customer data/iu.test(problem.message)
  );
}

function seconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export class ShopifyAdapter implements Adapter {
  readonly source: SourceFields;
  private readonly settings: ShopifySettings;
  private token?: { value: string; expires: number };
  private days = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" });
  /** The store's .myshopify.com domains; Shopify signs webhooks with its main one. */
  private domains: Set<string>;
  /** Attributes Shopify keeps back from this app, logged once each. */
  private readonly withheld = new Set<string>();

  constructor(config: SourceConfig) {
    this.settings = settings(config);
    this.domains = new Set([this.settings.shop]);
    this.source = {
      attributes: ATTRIBUTES.map(({ attribute }) => ({
        ...attribute,
        config: "",
      })),
      id: config.id,
      name: config.name,
      type: "shopify",
    };
  }

  /** The day of a moment in the shop's time zone, as `YYYY-MM-DD`. */
  day(iso: string): string {
    return this.days.format(new Date(iso));
  }

  orderUrl(order: Order): string {
    return `https://${this.settings.shop}/admin/orders/${order.legacyResourceId}`;
  }

  // Client credentials: tokens last a day, so one is kept until shortly before then.
  private async accessToken(): Promise<string> {
    const { accessToken, clientId, clientSecret, shop } = this.settings;
    if (accessToken) {
      return accessToken;
    }
    if (this.token && this.token.expires > Date.now()) {
      return this.token.value;
    }
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      body: new URLSearchParams({
        client_id: clientId ?? "",
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(
        `Shopify refused an access token (${response.status}): ${await response.text()}`
      );
    }
    const body = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    this.token = {
      expires: Date.now() + (body.expires_in ?? 86_399) * 1000 - TOKEN_MARGIN,
      value: body.access_token,
    };
    return body.access_token;
  }

  /**
   * Fields Shopify withholds come back as null, with the attributes that read
   * them noted, as long as the rest of the answer is there.
   */
  private async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
    attempt = 0
  ): Promise<T> {
    const { apiVersion, shop } = this.settings;
    const response = await fetch(
      `https://${shop}/admin/api/${apiVersion}/graphql.json`,
      {
        body: JSON.stringify({ query, variables }),
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": await this.accessToken(),
        },
        method: "POST",
      }
    );
    if (response.status === 401 && this.token && attempt === 0) {
      this.token = undefined;
      return this.graphql(query, variables, attempt + 1);
    }
    if (!response.ok) {
      throw new Error(
        `Shopify answered ${response.status}: ${await response.text()}`
      );
    }
    const body = (await response.json()) as GraphQLResponse<T>;
    const throttled = body.errors?.some(
      (error) => error.extensions?.code === "THROTTLED"
    );
    if (throttled && attempt < MAX_THROTTLED) {
      await sleep(2000 * (attempt + 1));
      return this.graphql(query, variables, attempt + 1);
    }
    const errors = body.errors ?? [];
    if (body.data && errors.length > 0 && errors.every(isWithheld)) {
      this.noteWithheld(errors);
      return body.data;
    }
    if (errors.length > 0 || !body.data) {
      throw new Error(
        `Shopify GraphQL: ${errors.map((error) => error.message).join("; ") || "no data"}`
      );
    }
    return body.data;
  }

  private noteWithheld(errors: GraphQLError[]): void {
    const fields = new Set(
      errors.flatMap((problem) => problem.path?.map(String) ?? [])
    );
    const attributes = ATTRIBUTES.filter(({ selection }) =>
      topLevelFields(selection).some((field) => fields.has(field))
    ).map(({ attribute }) => attribute.id);
    const fresh = attributes.filter((id) => !this.withheld.has(id));
    if (fresh.length > 0) {
      console.warn(
        `${this.source.id}: Shopify withholds ${fresh.join(", ")} from this app, ` +
          "so they stay empty. Names and emails need the Grow plan or higher, and the read_customers scope."
      );
    }
    for (const id of fresh) {
      this.withheld.add(id);
    }
  }

  private item(order: Order, wanted: Set<string>): Item {
    const values: Record<string, string[]> = {};
    for (const spec of ATTRIBUTES) {
      if (wanted.has(spec.attribute.id)) {
        values[spec.attribute.id] = spec.read(order, this);
      }
    }
    return {
      createdAt: seconds(order.createdAt),
      key: order.legacyResourceId,
      updatedAt: seconds(order.updatedAt),
      values,
    };
  }

  async start(callbackUrl?: string): Promise<void> {
    const { shop: details } = await this.graphql<{
      shop: {
        currencyCode: string;
        ianaTimezone: string;
        myshopifyDomain: string;
      };
    }>("{ shop { currencyCode ianaTimezone myshopifyDomain } }");
    this.domains.add(details.myshopifyDomain.toLowerCase());
    this.days = new Intl.DateTimeFormat("en-CA", {
      timeZone: details.ianaTimezone,
    });
    // Asking for one order with every attribute shows what Shopify keeps back,
    // so tables aren't offered fields that would stay empty.
    await this.graphql(
      `{ orders(first: 1) { nodes { ${orderSelection(new Set(ATTRIBUTES.map(({ attribute }) => attribute.id)))} } } }`
    );
    this.source.attributes = this.source.attributes
      .filter((attribute) => !this.withheld.has(attribute.id))
      .map((attribute) =>
        attribute.type === "currency"
          ? { ...attribute, config: details.currencyCode }
          : attribute
      );
    if (callbackUrl) {
      await this.ensureWebhooks(callbackUrl);
    }
  }

  // Our subscriptions point at this source's path; one on another host is from an old address.
  private async ensureWebhooks(callbackUrl: string): Promise<void> {
    const path = new URL(callbackUrl).pathname;
    const { webhookSubscriptions } = await this.graphql<{
      webhookSubscriptions: {
        nodes: { id: string; topic: string; uri: string }[];
      };
    }>(
      `query($topics: [WebhookSubscriptionTopic!]) {
        webhookSubscriptions(first: 50, topics: $topics) { nodes { id topic uri } }
      }`,
      { topics: Object.values(TOPICS) }
    );
    for (const subscription of webhookSubscriptions.nodes) {
      const stale =
        subscription.uri !== callbackUrl &&
        URL.canParse(subscription.uri) &&
        new URL(subscription.uri).pathname === path;
      if (stale) {
        // oxlint-disable-next-line no-await-in-loop -- a handful, in order
        await this.mutate(
          "webhookSubscriptionDelete",
          `mutation($id: ID!) {
            webhookSubscriptionDelete(id: $id) { userErrors { field message } }
          }`,
          { id: subscription.id }
        );
      }
    }
    for (const topic of Object.values(TOPICS)) {
      const exists = webhookSubscriptions.nodes.some(
        (subscription) =>
          subscription.topic === topic && subscription.uri === callbackUrl
      );
      if (!exists) {
        // oxlint-disable-next-line no-await-in-loop -- a handful, in order
        await this.mutate(
          "webhookSubscriptionCreate",
          `mutation($topic: WebhookSubscriptionTopic!, $uri: String!) {
            webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri }) {
              userErrors { field message }
            }
          }`,
          { topic, uri: callbackUrl }
        );
        console.log(`${this.source.id}: webhook ${topic} → ${callbackUrl}`);
      }
    }
  }

  private async mutate(
    name: string,
    query: string,
    variables: Record<string, unknown>
  ): Promise<void> {
    const data = await this.graphql<
      Record<string, { userErrors: UserError[] }>
    >(query, variables);
    const errors = data[name]?.userErrors ?? [];
    if (errors.length > 0) {
      throw new Error(
        `${name}: ${errors.map((error) => error.message).join("; ")}. ` +
          "Order webhooks need protected customer data access, approved in the app's Dev Dashboard."
      );
    }
  }

  private verify(delivery: Delivery): boolean {
    const header = delivery.headers["x-shopify-hmac-sha256"];
    const domain = delivery.headers["x-shopify-shop-domain"];
    if (
      typeof header !== "string" ||
      typeof domain !== "string" ||
      !this.domains.has(domain.toLowerCase())
    ) {
      return false;
    }
    const expected = createHmac("sha256", this.settings.clientSecret)
      .update(delivery.body)
      .digest();
    const given = Buffer.from(header, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async receive(
    delivery: Delivery,
    wanted: Set<string>
  ): Promise<Item[] | "invalid"> {
    if (!this.verify(delivery)) {
      return "invalid";
    }
    const topic = delivery.headers["x-shopify-topic"];
    if (!(typeof topic === "string" && topic in TOPICS)) {
      return [];
    }
    // Genuine but about no order: a retry wouldn't help.
    const id = webhookOrderId(delivery.body);
    if (!id) {
      return [];
    }
    // Webhook payloads can be redacted, so the order comes from the Admin API.
    const { order } = await this.graphql<{ order: Order | null }>(
      `query($id: ID!) { order(id: $id) { ${orderSelection(wanted)} } }`,
      { id }
    );
    return order ? [this.item(order, wanted)] : [];
  }

  private async ordersPage(
    after: string | null,
    since: Date,
    wanted: Set<string>
  ): Promise<OrdersPage> {
    const { orders } = await this.graphql<{ orders: OrdersPage }>(
      `query($after: String, $query: String) {
        orders(first: ${PAGE_SIZE}, after: $after, sortKey: UPDATED_AT, query: $query) {
          pageInfo { hasNextPage endCursor }
          nodes { ${orderSelection(wanted)} }
        }
      }`,
      { after, query: `updated_at:>='${since.toISOString()}'` }
    );
    return orders;
  }

  async *changedSince(since: Date, wanted: Set<string>): AsyncIterable<Item> {
    let after: string | null = null;
    do {
      // oxlint-disable-next-line no-await-in-loop -- each page starts where the last ended
      const page: OrdersPage = await this.ordersPage(after, since, wanted);
      for (const order of page.nodes) {
        yield this.item(order, wanted);
      }
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
  }
}
