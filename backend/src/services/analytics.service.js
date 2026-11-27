/**
 * Analytics & Reporting Service
 *
 * Runs aggregation pipelines over the double-entry ledger and usage records
 * for financial reporting, trial balances, and meter consumption analysis.
 */
import { getLedgerEntryModel, getBillingTransactionModel, getUsageRecordModel } from "../config/db.js";

/**
 * Computes financial ledger balances (Receivables, Revenue, Cash).
 */
export async function getFinancialSummary(tenantDb, { organizationId, from, to }) {
  const Ledger = getLedgerEntryModel(tenantDb);
  const Tx = getBillingTransactionModel(tenantDb);

  const match = { organizationId };
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }

  // 1. Double-Entry Balances by accountType
  const ledgerAggregation = await Ledger.aggregate([
    { $match: match },
    {
      $group: {
        _id: { accountType: "$accountType", entryType: "$entryType", currency: "$currency" },
        totalAmountMinor: { $sum: "$amountMinor" },
        count: { $sum: 1 }
      }
    }
  ]);

  let totalDebits = 0;
  let totalCredits = 0;
  const accounts = {
    receivable: { debit: 0, credit: 0, balanceMinor: 0 },
    revenue: { debit: 0, credit: 0, balanceMinor: 0 },
    cash: { debit: 0, credit: 0, balanceMinor: 0 }
  };

  for (const item of ledgerAggregation) {
    const { accountType, entryType } = item._id;
    const amount = item.totalAmountMinor;

    if (accounts[accountType]) {
      accounts[accountType][entryType] = amount;
    }

    if (entryType === "debit") totalDebits += amount;
    if (entryType === "credit") totalCredits += amount;
  }

  // Double-entry calculated balances:
  // Asset/Receivable balance = Debits - Credits
  // Revenue balance = Credits - Debits
  accounts.receivable.balanceMinor = accounts.receivable.debit - accounts.receivable.credit;
  accounts.revenue.balanceMinor = accounts.revenue.credit - accounts.revenue.debit;
  accounts.cash.balanceMinor = accounts.cash.debit - accounts.cash.credit;

  // 2. Transaction status breakdown
  const txStatusAggregation = await Tx.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalAmountMinor: { $sum: "$amountMinor" }
      }
    }
  ]);

  const transactions = {
    totalCount: 0,
    byStatus: {}
  };

  for (const item of txStatusAggregation) {
    transactions.totalCount += item.count;
    transactions.byStatus[item._id] = {
      count: item.count,
      totalAmountMinor: item.totalAmountMinor
    };
  }

  return {
    organizationId,
    trialBalance: {
      totalDebits,
      totalCredits,
      isBalanced: totalDebits === totalCredits
    },
    accounts,
    transactions
  };
}

/**
 * Canonical usage metric definitions with standardized labels and units.
 */
export const CANONICAL_METRICS = [
  { metricType: "api_requests", defaultUnit: "requests", label: "API requests" },
  { metricType: "compute_units", defaultUnit: "compute_units", label: "Compute units" },
  { metricType: "storage", defaultUnit: "GB-day", label: "Storage" }
];

/**
 * Computes aggregated usage metrics and consumption trends across canonical metrics.
 * Supports frontend charts for api_requests, compute_units, and storage with
 * rational quantity calculations, cost totals, and reporting period filters.
 */
export async function getUsageAnalytics(tenantDb, { organizationId, from, to, currency = "INR" }) {
  const Usage = getUsageRecordModel(tenantDb);
  const normalizedCurrency = String(currency || "INR").trim().toUpperCase();

  const match = { organizationId, currency: normalizedCurrency };
  if (from || to) {
    match.recordedAt = {};
    if (from) match.recordedAt.$gte = new Date(from);
    if (to) match.recordedAt.$lte = new Date(to);
  }

  const aggregation = await Usage.aggregate([
    { $match: match },
    {
      $project: {
        metricType: 1,
        totalCostMinor: 1,
        currency: 1,
        unit: 1,
        recordedAt: 1,
        quantity: {
          $cond: [
            { $gt: ["$quantityScale", 0] },
            { $divide: ["$quantityScaled", "$quantityScale"] },
            "$quantityScaled"
          ]
        }
      }
    },
    {
      $group: {
        _id: "$metricType",
        eventCount: { $sum: 1 },
        totalQuantity: { $sum: "$quantity" },
        totalCostMinor: { $sum: "$totalCostMinor" },
        currency: { $first: "$currency" },
        unit: { $first: "$unit" },
        lastRecordedAt: { $max: "$recordedAt" }
      }
    },
    { $sort: { totalCostMinor: -1 } }
  ]);

  const aggregatedMap = new Map();
  for (const item of aggregation) {
    aggregatedMap.set(item._id, item);
  }

  // Ensure all 3 canonical metrics are present in the response
  const byMetric = CANONICAL_METRICS.map(def => {
    const existing = aggregatedMap.get(def.metricType);
    if (existing) {
      return {
        metricType: def.metricType,
        label: def.label,
        eventCount: existing.eventCount,
        totalQuantity: Math.round(existing.totalQuantity * 10000) / 10000,
        totalCostMinor: existing.totalCostMinor,
        currency: existing.currency || normalizedCurrency,
        unit: existing.unit || def.defaultUnit,
        lastRecordedAt: existing.lastRecordedAt
      };
    }
    return {
      metricType: def.metricType,
      label: def.label,
      eventCount: 0,
      totalQuantity: 0,
      totalCostMinor: 0,
      currency: normalizedCurrency,
      unit: def.defaultUnit,
      lastRecordedAt: null
    };
  });

  const totalCostMinor = byMetric.reduce((acc, curr) => acc + curr.totalCostMinor, 0);
  const totalEvents = byMetric.reduce((acc, curr) => acc + curr.eventCount, 0);

  return {
    organizationId,
    currency: normalizedCurrency,
    reportingPeriod: {
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null
    },
    totalEvents,
    totalCostMinor,
    byMetric
  };
}

/**
 * Returns monthly net revenue for the last six calendar months.
 * Revenue is derived from double-entry ledger entries in the 'revenue' account:
 * Net Revenue = Credits (sales/accruals) - Debits (reversals/refunds).
 * Strictly filters by currency to prevent mixing differing monetary units.
 */
export async function getMonthlyRevenue(tenantDb, { organizationId, currency = "INR" }) {
  const Ledger = getLedgerEntryModel(tenantDb);
  const normalizedCurrency = String(currency || "INR").trim().toUpperCase();

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const aggregation = await Ledger.aggregate([
    {
      $match: {
        organizationId,
        accountType: "revenue",
        currency: normalizedCurrency,
        createdAt: { $gte: startDate, $lt: endDate }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          entryType: "$entryType"
        },
        totalAmountMinor: { $sum: "$amountMinor" },
        count: { $sum: 1 }
      }
    }
  ]);

  const monthlyTotals = new Map();
  for (const item of aggregation) {
    const key = `${item._id.year}-${String(item._id.month).padStart(2, "0")}`;
    const current = monthlyTotals.get(key) || { credit: 0, debit: 0 };
    current[item._id.entryType] = item.totalAmountMinor;
    monthlyTotals.set(key, current);
  }

  const months = [];
  let totalRevenueMinor = 0;

  for (let offset = 0; offset < 6; offset++) {
    const date = new Date(
      startDate.getFullYear(),
      startDate.getMonth() + offset,
      1
    );

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const totals = monthlyTotals.get(monthKey) || { credit: 0, debit: 0 };
    const netRevenueMinor = totals.credit - totals.debit;
    totalRevenueMinor += netRevenueMinor;

    months.push({
      month: date.toLocaleString("en-IN", { month: "short" }),
      monthKey,
      grossRevenueMinor: totals.credit,
      reversalMinor: totals.debit,
      revenueMinor: netRevenueMinor
    });
  }

  return {
    organizationId,
    currency: normalizedCurrency,
    totalRevenueMinor,
    period: {
      from: startDate.toISOString(),
      to: new Date(endDate.getTime() - 1).toISOString()
    },
    months
  };
}
