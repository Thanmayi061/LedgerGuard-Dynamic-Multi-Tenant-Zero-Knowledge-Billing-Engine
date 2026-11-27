import "dotenv/config";
import { getPlatformConnection, getTenantConnection, closeDatabaseConnections } from "../src/connections.js";
import { Organization, getUserModel, getBillingTransactionModel, getLedgerEntryModel, getUsageRecordModel, getPricingPlanModel } from "../src/models.js";

const now = new Date();
const tenants = [
  {
    org: { organizationId:"org_acme_001", name:"Acme Technologies", email:"admin@acme.example", status:"active", plan:"growth", databaseName:"tenant_acme_db" },
    user: { organizationId:"org_acme_001", name:"Acme Admin", email:"admin@acme.example", passwordHash:"REPLACE_WITH_REAL_PASSWORD_HASH", role:"admin", isActive:true },
    tx: { transactionId:"txn_acme_demo_001", organizationId:"org_acme_001", amountMinor:129900, currency:"INR", status:"success", idempotencyKey:"idem_acme_demo_001", requestHash:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", failureReason:null, reversedAt:null, idempotency:{status:"completed",response:{transactionId:"txn_acme_demo_001",status:"success"},completedAt:now}, description:"Demo subscription" },
    usage: { organizationId:"org_acme_001", eventId:"usage_acme_001", metricType:"api_requests", quantityScaled:1000, quantityScale:1, unit:"request", unitPriceMinor:2, totalCostMinor:2000, currency:"INR", recordedAt:now },
    plan: { planCode:"growth", version:1, name:"Growth", rates:[{metricType:"api_requests",unit:"request",unitPriceMinor:2,currency:"INR"},{metricType:"compute_units",unit:"unit",unitPriceMinor:10,currency:"INR"},{metricType:"storage",unit:"GB-day",unitPriceMinor:5,currency:"INR"}], effectiveFrom:now, isActive:true }
  },
  {
    org: { organizationId:"org_zenith_002", name:"Zenith Labs", email:"admin@zenith.example", status:"active", plan:"starter", databaseName:"tenant_zenith_db" },
    user: { organizationId:"org_zenith_002", name:"Zenith Admin", email:"admin@zenith.example", passwordHash:"REPLACE_WITH_REAL_PASSWORD_HASH", role:"admin", isActive:true },
    tx: { transactionId:"txn_zenith_demo_001", organizationId:"org_zenith_002", amountMinor:49900, currency:"INR", status:"success", idempotencyKey:"idem_zenith_demo_001", requestHash:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", failureReason:null, reversedAt:null, idempotency:{status:"completed",response:{transactionId:"txn_zenith_demo_001",status:"success"},completedAt:now}, description:"Demo subscription" },
    usage: { organizationId:"org_zenith_002", eventId:"usage_zenith_001", metricType:"compute_units", quantityScaled:275, quantityScale:100, unit:"unit", unitPriceMinor:10, totalCostMinor:28, currency:"INR", recordedAt:now },
    plan: { planCode:"starter", version:1, name:"Starter", rates:[{metricType:"api_requests",unit:"request",unitPriceMinor:3,currency:"INR"},{metricType:"compute_units",unit:"unit",unitPriceMinor:12,currency:"INR"},{metricType:"storage",unit:"GB-day",unitPriceMinor:7,currency:"INR"}], effectiveFrom:now, isActive:true }
  }
];

try {
  const platform = await getPlatformConnection();
  const Org = platform.models.Organization || platform.model("Organization", Organization.schema);
  await Org.createIndexes();

  for (const t of tenants) {
    await Org.updateOne({organizationId:t.org.organizationId}, {$setOnInsert:t.org}, {upsert:true});
    const db = await getTenantConnection(t.org.organizationId);
    const User=getUserModel(db), Tx=getBillingTransactionModel(db), Ledger=getLedgerEntryModel(db);
    const Usage=getUsageRecordModel(db), Plan=getPricingPlanModel(db);
    await Promise.all([User.createIndexes(),Tx.createIndexes(),Ledger.createIndexes(),Usage.createIndexes(),Plan.createIndexes()]);
    await User.updateOne({email:t.user.email},{$setOnInsert:t.user},{upsert:true});
    await Tx.updateOne({transactionId:t.tx.transactionId},{$setOnInsert:t.tx},{upsert:true});
    await Usage.updateOne({eventId:t.usage.eventId},{$setOnInsert:t.usage},{upsert:true});
    await Plan.updateOne({planCode:t.plan.planCode,version:t.plan.version},{$setOnInsert:t.plan},{upsert:true});
    const savedTx=await Tx.findOne({transactionId:t.tx.transactionId});
    const journalId=`JRN-${t.tx.transactionId}`;
    if (!(await Ledger.countDocuments({journalId}))) {
      await Ledger.insertMany([
        {organizationId:t.org.organizationId,transactionRef:savedTx._id,transactionId:t.tx.transactionId,journalId,accountType:"receivable",entryType:"debit",amountMinor:t.tx.amountMinor,currency:"INR", reversalOf:null, reversalOfJournalId:null, reversalOfTransactionRef:null, reversalReason:null},
        {organizationId:t.org.organizationId,transactionRef:savedTx._id,transactionId:t.tx.transactionId,journalId,accountType:"revenue",entryType:"credit",amountMinor:t.tx.amountMinor,currency:"INR", reversalOf:null, reversalOfJournalId:null, reversalOfTransactionRef:null, reversalReason:null}
      ]);
    }
    console.log(`Seeded ${t.org.organizationId} in ${t.org.databaseName}`);
  }
  console.log("Seed complete. Demo password hashes are placeholders; replace before login use.");
} catch (e) {
  console.error(e);
  process.exitCode=1;
} finally {
  await closeDatabaseConnections();
}
