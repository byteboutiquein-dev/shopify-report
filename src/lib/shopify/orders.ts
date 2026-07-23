import "server-only";

import { shopifyGraphql } from "@/lib/shopify/client";

function ordersQuery() {
  return `
  query OrdersForReport($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          id
          name
          createdAt
          updatedAt
          displayFinancialStatus
          displayFulfillmentStatus
          billingAddress {
            firstName
            lastName
            name
          }
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          shippingAddress {
            city
            firstName
            lastName
            name
            province
            provinceCode
          }
          shippingChargeMetafield: metafield(namespace: "custom", key: "shipping_charge") {
            key
            namespace
            type
            value
          }
          fulfillments(first: 5) {
            trackingInfo {
              company
              number
              url
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
}

type ShopifyMetafield = {
  key: string;
  namespace: string;
  type: string;
  value: string;
} | null;

export type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  billingAddress: {
    firstName: string | null;
    lastName: string | null;
    name: string | null;
  } | null;
  totalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  shippingAddress: {
    city: string | null;
    firstName: string | null;
    lastName: string | null;
    name: string | null;
    province: string | null;
    provinceCode: string | null;
  } | null;
  shippingChargeMetafield: ShopifyMetafield;
  fulfillments: Array<{
    trackingInfo: Array<{
      company: string | null;
      number: string | null;
      url: string | null;
    }>;
  }>;
};

type OrdersResponse = {
  orders: {
    edges: Array<{
      cursor: string;
      node: ShopifyOrderNode;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
};

export type FetchShopifyOrdersInput = {
  startDate?: string;
  endDate?: string;
  limit?: number;
  stopAtShopifyOrderId?: string | null;
};

export function buildShopifyDateQuery(input: FetchShopifyOrdersInput) {
  const parts: string[] = [];

  if (input.startDate) {
    parts.push(`created_at:>=${input.startDate}`);
  }

  if (input.endDate) {
    parts.push(`created_at:<=${input.endDate}`);
  }

  return parts.length ? parts.join(" ") : undefined;
}

export async function fetchShopifyOrders(input: FetchShopifyOrdersInput) {
  const orders: ShopifyOrderNode[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  const pageSize = 100;
  const maxOrders = input.limit ?? 500;
  const query = buildShopifyDateQuery(input);
  const graphqlQuery = ordersQuery();

  while (hasNextPage && orders.length < maxOrders) {
    const data: OrdersResponse = await shopifyGraphql<OrdersResponse>(graphqlQuery, {
      first: Math.min(pageSize, maxOrders - orders.length),
      after,
      query
    });

    for (const edge of data.orders.edges) {
      if (input.stopAtShopifyOrderId && edge.node.id === input.stopAtShopifyOrderId) {
        hasNextPage = false;
        break;
      }

      orders.push(edge.node);
    }

    if (!hasNextPage) {
      break;
    }

    hasNextPage = data.orders.pageInfo.hasNextPage;
    after = data.orders.pageInfo.endCursor;
  }

  return orders;
}
