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
 * Computes aggregated usage metrics and consumption trends.
 */
export async function getUsageAnalytics(tenantDb, { organizationId, from, to }) {
  const Usage = getUsageRecordModel(tenantDb);

  const match = { organizationId };
  if (from || to) {
    match.recordedAt = {};
    if (from) match.recordedAt.$gte = new Date(from);
    if (to) match.recordedAt.$lte = new Date(to);
  }

  const aggregation = await Usage.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$metricType",
        eventCount: { $sum: 1 },
        totalCostMinor: { $sum: "$totalCostMinor" },
        currency: { $first: "$currency" },
        unit: { $first: "$unit" }
      }
    },
    { $sort: { totalCostMinor: -1 } }
  ]);

  const totalCostMinor = aggregation.reduce((acc, curr) => acc + curr.totalCostMinor, 0);
  const totalEvents = aggregation.reduce((acc, curr) => acc + curr.eventCount, 0);

  return {
    organizationId,
    totalEvents,
    totalCostMinor,
    byMetric: aggregation.map(item => ({
      metricType: item._id,
      eventCount: item.eventCount,
      totalCostMinor: item.totalCostMinor,
      currency: item.currency,
      unit: item.unit
    }))
  };
}
